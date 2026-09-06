import { zipSync, strToU8 } from 'fflate'
import type { ExtrudedMesh } from './mesh'
import type { Filament, NameplateDesign, PrinterModel } from '../domain'
import h2sProfile from './profiles/h2s.json'
import p2sProfile from './profiles/p2s.json'

export interface ExportPart {
  id: number
  name: string
  mesh: ExtrudedMesh
  filamentId: string
}

export interface Build3mfOptions {
  design: NameplateDesign
  baseMesh: ExtrudedMesh
  glyphParts: ExportPart[]
  printer: PrinterModel
}

interface ProcessedPart {
  id: number
  name: string
  mesh: ExtrudedMesh
  extruder: number
  objectUuid: string
  componentUuid: string
  partUuid: string
  cx: number
  cy: number
  cz: number
  localVertices: Float32Array
  trianglesCount: number
}

// Minimal valid 1x1 PNG bytes (82 bytes)
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
])

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Generates a full Bambu Studio project .3mf archive matching native Bambu Studio multi-part structure.
 */
export function buildBambuProject3mf(options: Build3mfOptions): Uint8Array {
  const { design, baseMesh, glyphParts, printer } = options

  // 1. Bed center calculation
  // P2S bed: 256 x 256 mm -> Center: (128, 128)
  // H2S bed: 340 x 320 mm -> Center: (170, 160)
  const isH2S = printer === 'H2S'
  const bedCenterX = isH2S ? 170 : 128
  const bedCenterY = isH2S ? 160 : 128

  // 2. Collect used filaments in order (Slot 1: BasePlate, Slot 2+: Glyphs)
  const baseFilamentId = design.base.filamentId
  const usedFilamentIds = [baseFilamentId]
  glyphParts.forEach((part) => {
    if (!usedFilamentIds.includes(part.filamentId)) {
      usedFilamentIds.push(part.filamentId)
    }
  })

  // Map each filament ID to a 1-based extruder slot (1..N)
  const filamentExtruderMap: Record<string, number> = {}
  usedFilamentIds.forEach((id, index) => {
    filamentExtruderMap[id] = index + 1
  })

  // Exact used filaments list (only export active filaments, matching Bambu Studio behavior)
  const activeFilaments: Filament[] = usedFilamentIds.map((id, index) => {
    const found = design.filaments.find((f) => f.id === id)
    return (
      found || {
        id,
        name: `Filament ${index + 1}`,
        hex: index === 0 ? '#1B2F54' : '#F7F8FB',
        material: 'PLA',
      }
    )
  })

  // 3. Assemble parts list (Part 1: BasePlate, Part 2+: Glyphs)
  const basePart: ExportPart = {
    id: 1,
    name: 'BasePlate',
    mesh: baseMesh,
    filamentId: baseFilamentId,
  }

  const allParts: ExportPart[] = [
    basePart,
    ...glyphParts.map((p, idx) => ({
      ...p,
      id: 2 + idx,
    })),
  ]

  // 4. Compute local centers and offset vertices for Bambu Studio native structure
  const processedParts: ProcessedPart[] = allParts.map((part, index) => {
    const { vertices, indices } = part.mesh
    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    let minZ = Infinity, maxZ = -Infinity

    for (let i = 0; i < vertices.length; i += 3) {
      const x = vertices[i]
      const y = vertices[i + 1]
      const z = vertices[i + 2]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }

    let cx = 0
    let cy = 0
    const cz = (minZ + maxZ) / 2

    if (index > 0) {
      // Glyphs are centered around their XY bounding box center
      cx = (minX + maxX) / 2
      cy = (minY + maxY) / 2
    }

    const localVertices = new Float32Array(vertices.length)
    for (let i = 0; i < vertices.length; i += 3) {
      localVertices[i] = vertices[i] - cx
      localVertices[i + 1] = vertices[i + 1] - cy
      localVertices[i + 2] = vertices[i + 2] - cz
    }

    return {
      id: part.id,
      name: part.name,
      mesh: part.mesh,
      extruder: filamentExtruderMap[part.filamentId] || 1,
      objectUuid: generateUuid(),
      componentUuid: generateUuid(),
      partUuid: generateUuid(),
      cx,
      cy,
      cz,
      localVertices,
      trianglesCount: indices.length / 3,
    }
  })

  const assemblyId = processedParts.length + 1
  const rootAssemblyUuid = generateUuid()
  const buildUuid = generateUuid()
  const itemUuid = generateUuid()

  // 5. Generate XML / Config content
  const objectsModelXml = generateObjectsModelXml(processedParts)
  const assemblyModelXml = generateAssemblyModelXml({
    designTitle: design.title || 'Nameplate',
    parts: processedParts,
    assemblyId,
    rootAssemblyUuid,
    buildUuid,
    itemUuid,
    bedCenterX,
    bedCenterY,
  })
  const modelSettingsXml = generateModelSettingsXml({
    designTitle: design.title || 'Nameplate',
    parts: processedParts,
    assemblyId,
    bedCenterX,
    bedCenterY,
    filamentCount: activeFilaments.length,
  })
  const projectSettingsJson = generateProjectSettingsJson({
    isH2S,
    colors: activeFilaments.map((f) => f.hex),
  })

  // 6. Metadata relationships and types
  const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
 <Relationship Target="/Metadata/plate_1.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>
 <Relationship Target="/Metadata/plate_1.png" Id="rel-4" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-middle"/>
 <Relationship Target="/Metadata/plate_1_small.png" Id="rel-5" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-small"/>
</Relationships>`

  const modelRelsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/Objects/object_1.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="config" ContentType="text/plain"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="gcode" ContentType="text/x.gcode"/>
</Types>`

  const sliceInfoXml = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
    <header_item key="X-BBL-Client-Version" value="02.08.02.61"/>
  </header>
</config>`

  const cutInfoXml = `<?xml version="1.0" encoding="utf-8"?>
<objects>
 <object id="1">
  <cut_id id="0" check_sum="1" connectors_cnt="0"/>
 </object>
</objects>`

  const filamentSequenceJson = JSON.stringify({
    plate_1: { nozzle_sequence: [], optimal_assignment: [], sequence: [] },
  })

  // 7. Package into ZIP
  const zipRecord: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypesXml),
    '_rels/.rels': strToU8(relsXml),
    '3D/_rels/3dmodel.model.rels': strToU8(modelRelsXml),
    '3D/3dmodel.model': strToU8(assemblyModelXml),
    '3D/Objects/object_1.model': strToU8(objectsModelXml),
    'Metadata/model_settings.config': strToU8(modelSettingsXml),
    'Metadata/project_settings.config': strToU8(projectSettingsJson),
    'Metadata/slice_info.config': strToU8(sliceInfoXml),
    'Metadata/cut_information.xml': strToU8(cutInfoXml),
    'Metadata/filament_sequence.json': strToU8(filamentSequenceJson),
    'Metadata/plate_1.png': TINY_PNG,
    'Metadata/plate_1_small.png': TINY_PNG,
    'Metadata/plate_no_light_1.png': TINY_PNG,
    'Metadata/top_1.png': TINY_PNG,
    'Metadata/pick_1.png': TINY_PNG,
  }

  return zipSync(zipRecord, { level: 6 })
}

function generateObjectsModelXml(parts: ProcessedPart[]): string {
  let objectsXml = ''

  for (const part of parts) {
    const { localVertices, mesh } = part
    const indices = mesh.indices

    let verticesXml = ''
    for (let i = 0; i < localVertices.length; i += 3) {
      verticesXml += `     <vertex x="${localVertices[i].toFixed(4)}" y="${localVertices[i + 1].toFixed(4)}" z="${localVertices[i + 2].toFixed(4)}"/>\n`
    }

    let trianglesXml = ''
    for (let i = 0; i < indices.length; i += 3) {
      trianglesXml += `     <triangle v1="${indices[i]}" v2="${indices[i + 1]}" v3="${indices[i + 2]}"/>\n`
    }

    objectsXml += `  <object id="${part.id}" p:UUID="${part.objectUuid}" type="model">\n`
    objectsXml += `   <mesh>\n`
    objectsXml += `    <vertices>\n${verticesXml}    </vertices>\n`
    objectsXml += `    <triangles>\n${trianglesXml}    </triangles>\n`
    objectsXml += `   </mesh>\n`
    objectsXml += `  </object>\n`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources>
${objectsXml} </resources>
 <build/>
</model>`
}

function generateAssemblyModelXml({
  designTitle,
  parts,
  assemblyId,
  rootAssemblyUuid,
  buildUuid,
  itemUuid,
  bedCenterX,
  bedCenterY,
}: {
  designTitle: string
  parts: ProcessedPart[]
  assemblyId: number
  rootAssemblyUuid: string
  buildUuid: string
  itemUuid: string
  bedCenterX: number
  bedCenterY: number
}): string {
  let componentsXml = ''

  for (const part of parts) {
    componentsXml += `    <component p:path="/3D/Objects/object_1.model" objectid="${part.id}" p:UUID="${part.componentUuid}" transform="1 0 0 0 1 0 0 0 1 ${part.cx.toFixed(4)} ${part.cy.toFixed(4)} ${part.cz.toFixed(4)}"/>\n`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="Application">BambuStudio-02.08.02.61</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">${escapeXml(designTitle)}</metadata>
 <resources>
  <object id="${assemblyId}" p:UUID="${rootAssemblyUuid}" type="model">
   <components>
${componentsXml}   </components>
  </object>
 </resources>
 <build p:UUID="${buildUuid}">
  <item objectid="${assemblyId}" p:UUID="${itemUuid}" transform="1 0 0 0 1 0 0 0 1 ${bedCenterX} ${bedCenterY} 0" printable="1"/>
 </build>
</model>`
}

function generateModelSettingsXml({
  designTitle,
  parts,
  assemblyId,
  bedCenterX,
  bedCenterY,
  filamentCount,
}: {
  designTitle: string
  parts: ProcessedPart[]
  assemblyId: number
  bedCenterX: number
  bedCenterY: number
  filamentCount: number
}): string {
  const totalFaces = parts.reduce((sum, p) => sum + p.trianglesCount, 0)
  let partsXml = ''
  let assembleItemsXml = ''

  parts.forEach((part, index) => {
    partsXml += `    <part id="${part.id}" subtype="normal_part" uuid="${part.partUuid}">\n`
    partsXml += `      <metadata key="name" value="${escapeXml(part.name)}"/>\n`
    partsXml += `      <metadata key="matrix" value="1 0 0 ${part.cx.toFixed(4)} 0 1 0 ${part.cy.toFixed(4)} 0 0 1 ${part.cz.toFixed(4)} 0 0 0 1"/>\n`
    partsXml += `      <metadata key="source_file" value="${escapeXml(part.name)}.stl"/>\n`
    partsXml += `      <metadata key="source_object_id" value="0"/>\n`
    partsXml += `      <metadata key="source_volume_id" value="0"/>\n`
    partsXml += `      <metadata key="source_offset_x" value="${part.cx.toFixed(4)}"/>\n`
    partsXml += `      <metadata key="source_offset_y" value="${part.cy.toFixed(4)}"/>\n`
    partsXml += `      <metadata key="source_offset_z" value="${part.cz.toFixed(4)}"/>\n`
    partsXml += `      <metadata key="extruder" value="${part.extruder}"/>\n`
    partsXml += `      <mesh_stat face_count="${part.trianglesCount}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>\n`
    partsXml += `    </part>\n`

    assembleItemsXml += `   <assemble_item object_id="${assemblyId}" volume_id="${index}" transform="1 0 0 0 1 0 0 0 1 ${part.cx.toFixed(4)} ${part.cy.toFixed(4)} ${part.cz.toFixed(4)}" />\n`
  })

  const filamentMapsStr = Array(filamentCount).fill('1').join(' ')

  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="${assemblyId}">
    <metadata key="name" value="${escapeXml(designTitle)}"/>
    <metadata key="extruder" value="1"/>
    <metadata face_count="${totalFaces}"/>
${partsXml}  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
    <metadata key="filament_map_mode" value="Auto For Flush"/>
    <metadata key="filament_maps" value="${filamentMapsStr}"/>
    <metadata key="filament_volume_maps" value="${filamentMapsStr}"/>
    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>
    <metadata key="thumbnail_no_light_file" value="Metadata/plate_no_light_1.png"/>
    <metadata key="top_file" value="Metadata/top_1.png"/>
    <metadata key="pick_file" value="Metadata/pick_1.png"/>
    <model_instance>
      <metadata key="object_id" value="${assemblyId}"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="1"/>
    </model_instance>
  </plate>
  <assemble>
   <assemble_item object_id="${assemblyId}" instance_id="0" transform="1 0 0 0 1 0 0 0 1 ${bedCenterX} ${bedCenterY} 0" offset="0 0 0" />
${assembleItemsXml}  </assemble>
</config>`
}

function generateProjectSettingsJson({
  isH2S,
  colors,
}: {
  isH2S: boolean
  colors: string[]
}): string {
  const baseProfile = isH2S ? h2sProfile : p2sProfile
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config: Record<string, any> = JSON.parse(JSON.stringify(baseProfile))
  const n = colors.length
  const pmodel = isH2S ? 'H2S' : 'P2S'

  // Expand arrays based on length in canonical base profile (which has 2 filaments):
  // - length === 2: 1 * n keys (1 item per filament slot)
  // - length === 6: 3 * n keys (3 items per filament slot for 3 extruder variants)
  for (const [key, value] of Object.entries(config)) {
    if (Array.isArray(value)) {
      if (value.length === 2) {
        config[key] = Array(n).fill(value[0])
      } else if (value.length === 6) {
        const pattern = value.slice(0, 3)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const expanded: any[] = []
        for (let i = 0; i < n; i++) {
          expanded.push(...pattern)
        }
        config[key] = expanded
      }
    }
  }

  // Filament specifics
  config.filament_colour = colors.map((c) => c.toUpperCase())
  config.filament_type = Array(n).fill('PLA')
  config.filament_settings_id = Array(n).fill(`Bambu PLA Basic @BBL ${pmodel}`)
  config.nozzle_diameter = ['0.4']
  config.extruder_ams_count = Array(n).fill('1#0|4#0')
  config.filament_map = Array(n).fill('1')
  config.filament_volume_map = Array(n).fill('0')
  config.default_filament_colour = Array(n).fill('')

  // filament_self_index: for each filament i (1..n), repeated 3 times
  const selfIdx: string[] = []
  for (let i = 1; i <= n; i++) {
    selfIdx.push(String(i), String(i), String(i))
  }
  config.filament_self_index = selfIdx

  // N x N flush volumes matrix
  const matrix: string[] = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      matrix.push(i === j ? '0' : '280')
    }
  }
  config.flush_volumes_matrix = matrix
  config.flush_volumes_vector = Array(n * 2).fill('140')

  // Explicit printer boundaries & wipe tower coordinates
  if (isH2S) {
    config.printer_model = 'Bambu Lab H2S'
    config.printer_settings_id = 'Bambu Lab H2S 0.4 nozzle'
    config.print_settings_id = '0.20mm Standard @BBL H2S'
    config.default_print_profile = '0.20mm Standard @BBL H2S'
    config.printable_area = ['0x0', '340x0', '340x320', '0x320']
    config.printable_height = '340'
    config.wipe_tower_x = ['165']
    config.wipe_tower_y = ['250']
  } else {
    config.printer_model = 'Bambu Lab P2S'
    config.printer_settings_id = 'Bambu Lab P2S 0.4 nozzle'
    config.print_settings_id = '0.20mm Standard @BBL P2S'
    config.default_print_profile = '0.20mm Standard @BBL P2S'
    config.printable_area = ['0x0', '256x0', '256x256', '0x256']
    config.printable_height = '256'
    config.wipe_tower_x = ['170']
    config.wipe_tower_y = ['190']
  }

  return JSON.stringify(config, null, 4)
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
