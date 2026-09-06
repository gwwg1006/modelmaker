/** Shared, serializable design and geometry contract. Values are millimetres. */
export type PrinterModel = 'P2S' | 'H2S'
export type PresetId = 'nameplate' | 'plaque'
export type PartKind = 'base' | 'glyph'
export type Severity = 'error' | 'warning' | 'info'

export interface Filament {
  /** Stable design-local ID. Extruder numbers are assigned only during export. */
  id: string
  name: string
  hex: string
  material: 'PLA'
}

export interface BaseSettings {
  width: number
  height: number
  thickness: number
  cornerRadius: number
  marginX: number
  marginY: number
  filamentId: string
}

export interface TypographySettings {
  fontId: 'noto-sans-kr-bold' | 'noto-sans-kr-black'
  lineAlign: 'left' | 'center' | 'right'
  /** Requested first-line cap height in mm before automatic uniform fitting. */
  fontSize: number
  secondLineScale: number
  lineGap: number
  letterSpacing: number
  embossHeight: number
  defaultFilamentId: string
  /** `"line:character"` uses NFC-normalized character indexes, for example `"0:2"`. */
  characterFilamentIds: Record<string, string | undefined>
}

export interface NameplateDesign {
  schemaVersion: 1
  id: string
  title: string
  /** Original user input; it is never silently trimmed or normalized. */
  lines: string[]
  preset: PresetId
  printer: PrinterModel
  filaments: Filament[]
  base: BaseSettings
  typography: TypographySettings
}

export interface Vec2 { x: number; y: number }
export interface Bounds3 { min: [number, number, number]; max: [number, number, number] }
export interface FootprintGroup { outer: Vec2[]; holes: Vec2[][] }

export interface MeshPart {
  id: string
  kind: PartKind
  filamentId: string
  /** Mesh arrays are in one shared assembly coordinate system. */
  vertices: Float32Array
  indices: Uint32Array
  bounds: Bounds3
  footprints: FootprintGroup[]
  source?: { lineIndex: number; characterIndex: number; normalizedCharacter: string }
}

export interface DesignLayout {
  normalizedLines: string[]
  appliedScale: number
  textBounds: { min: Vec2; max: Vec2 }
  totalWidth: number
  totalHeight: number
}

export interface Diagnostic {
  code: string
  severity: Severity
  message: string
  target?: { lineIndex?: number; characterIndex?: number; partId?: string }
}

export interface GeometryResult {
  requestId: number
  designId: string
  parts: MeshPart[]
  layout: DesignLayout
  diagnostics: Diagnostic[]
}

export interface ValidationReport {
  ok: boolean
  diagnostics: Diagnostic[]
}

export interface BambuProjectProfile {
  id: string
  printer: PrinterModel
  studioVersion: string
  /** A Bambu Studio project archive that was separately registered as supported. */
  templateArchive: Uint8Array
  /** The exporter rejects profiles without this explicit evidence marker. */
  validated: boolean
}

export interface ExportResult {
  filename: string
  bytes: Uint8Array
  manifest: {
    printer: PrinterModel
    profileId: string
    filamentExtruders: Record<string, number>
    partExtruders: Record<string, number>
    modelPath: '3D/3dmodel.model'
  }
}

export type WorkerRequest =
  | { type: 'generate'; requestId: number; design: NameplateDesign; font: ArrayBuffer }
  | { type: 'dispose'; requestId: number }

export type WorkerResponse =
  | { type: 'generated'; requestId: number; result: GeometryResult; validation: ValidationReport }
  | { type: 'failed'; requestId: number; diagnostics: Diagnostic[] }
