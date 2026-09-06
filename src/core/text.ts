import opentype from 'opentype.js'
import type { Diagnostic, NameplateDesign, Vec2 } from '../domain'

const allowedSymbols = new Set('- _ . , ! ? & ( ) / : +')

export interface ParsedFont {
  font: opentype.Font
  unitsPerEm: number
}

export interface GlyphOutline {
  lineIndex: number
  characterIndex: number
  character: string
  advance: number
  contours: Vec2[][]
}

export function normalizeAndValidate(lines: string[]): { normalizedLines: string[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  if (lines.length < 1 || lines.length > 2) {
    diagnostics.push({ code: 'LINE_COUNT', severity: 'error', message: '문구는 1~2줄로 입력해 주세요.' })
  }
  const normalizedLines = lines.map((line) => line.normalize('NFC'))
  const joined = normalizedLines.join('')
  if (!joined.trim()) diagnostics.push({ code: 'EMPTY_TEXT', severity: 'error', message: '출력할 이름이나 문구를 입력해 주세요.' })
  const characters = [...joined]
  if (characters.length > 40) diagnostics.push({ code: 'TEXT_TOO_LONG', severity: 'error', message: '문구는 총 40글자까지 입력할 수 있습니다.' })
  normalizedLines.forEach((line, lineIndex) => {
    if ([...line].length > 24) diagnostics.push({ code: 'LINE_TOO_LONG', severity: 'error', message: '한 줄은 24글자까지 입력할 수 있습니다.', target: { lineIndex } })
    ;[...line].forEach((character, characterIndex) => {
      if (!isAllowedCharacter(character)) {
        diagnostics.push({ code: 'UNSUPPORTED_CHARACTER', severity: 'error', message: `‘${character}’는 현재 만들 수 없는 문자입니다.`, target: { lineIndex, characterIndex } })
      }
    })
  })
  return { normalizedLines, diagnostics }
}

function isAllowedCharacter(character: string): boolean {
  return character === ' ' || /[A-Za-z0-9]/u.test(character) || /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/u.test(character) || allowedSymbols.has(character)
}

export function parseFont(bytes: ArrayBuffer): ParsedFont {
  const font = opentype.parse(bytes)
  return { font, unitsPerEm: font.unitsPerEm }
}

export interface PositionedGlyph {
  lineIndex: number
  characterIndex: number
  character: string
  advance: number
  contours: Vec2[][]
  x: number
  y: number
}

export interface TextLayoutResult {
  glyphs: PositionedGlyph[]
  appliedScale: number
  textBounds: { min: Vec2; max: Vec2 }
  totalWidth: number
  totalHeight: number
}

/** Converts OpenType commands to contour rings with standard Cartesian coordinates (Y up). */
export function glyphOutline(font: opentype.Font, character: string, lineIndex: number, characterIndex: number, fontSize: number, x: number, baselineY: number): GlyphOutline {
  const glyph = font.charToGlyph(character)
  if (character !== ' ' && glyph.index === 0) throw new Error(`MISSING_GLYPH:${character}`)
  const path = glyph.getPath(x, baselineY, fontSize)
  return {
    lineIndex,
    characterIndex,
    character,
    advance: ((glyph.advanceWidth ?? font.unitsPerEm) / font.unitsPerEm) * fontSize,
    contours: flattenPath(path.commands),
  }
}

type PathCommand = opentype.PathCommand

function flattenPath(commands: PathCommand[]): Vec2[][] {
  const contours: Vec2[][] = []
  let contour: Vec2[] = []
  let cursor: Vec2 = { x: 0, y: 0 }
  let start: Vec2 = cursor
  // Note: OpenType getPath has Y going downward. We invert Y so Y points upward (+Y is top).
  const push = (point: Vec2) => {
    const p = { x: point.x, y: -point.y }
    contour.push(p)
    cursor = point
  }
  const finish = () => {
    const cleaned = cleanRing(contour)
    if (cleaned.length >= 3 && Math.abs(signedArea(cleaned)) > 1e-6) {
      contours.push(cleaned)
    }
    contour = []
  }
  for (const command of commands) {
    if (command.type === 'M') {
      finish()
      cursor = { x: command.x, y: command.y }
      start = cursor
      contour.push({ x: cursor.x, y: -cursor.y })
    } else if (command.type === 'L') {
      push({ x: command.x, y: command.y })
    } else if (command.type === 'C') {
      const from = cursor
      for (let step = 1; step <= 8; step += 1) {
        const t = step / 8
        push(cubic(from, { x: command.x1, y: command.y1 }, { x: command.x2, y: command.y2 }, { x: command.x, y: command.y }, t))
      }
    } else if (command.type === 'Q') {
      const from = cursor
      for (let step = 1; step <= 6; step += 1) {
        const t = step / 6
        push(quadratic(from, { x: command.x1, y: command.y1 }, { x: command.x, y: command.y }, t))
      }
    } else if (command.type === 'Z') {
      finish()
    }
  }
  finish()
  return contours
}

function quadratic(a: Vec2, b: Vec2, c: Vec2, t: number): Vec2 {
  const u = 1 - t
  return { x: u * u * a.x + 2 * u * t * b.x + t * t * c.x, y: u * u * a.y + 2 * u * t * b.y + t * t * c.y }
}
function cubic(a: Vec2, b: Vec2, c: Vec2, d: Vec2, t: number): Vec2 {
  const u = 1 - t
  return {
    x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x,
    y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y,
  }
}
function cleanRing(points: Vec2[]): Vec2[] {
  const cleaned = points.filter((point, index) => index === 0 || distanceSquared(point, points[index - 1]) > 1e-8)
  if (cleaned.length > 2 && distanceSquared(cleaned[0], cleaned[cleaned.length - 1]) < 1e-8) {
    cleaned.pop()
  }
  return cleaned
}
function distanceSquared(a: Vec2, b: Vec2): number { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 }
export function signedArea(points: Vec2[]): number { return points.reduce((area, point, index) => { const next = points[(index + 1) % points.length]; return area + point.x * next.y - next.x * point.y }, 0) / 2 }

export function textDiagnostics(design: NameplateDesign, parsed: ParsedFont, normalizedLines: string[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  normalizedLines.forEach((line, lineIndex) => {
    ;[...line].forEach((character, characterIndex) => {
      if (character !== ' ' && parsed.font.charToGlyph(character).index === 0) diagnostics.push({ code: 'MISSING_GLYPH', severity: 'error', message: `글꼴에 ‘${character}’ 윤곽이 없습니다.`, target: { lineIndex, characterIndex } })
    })
  })
  if (!design.typography.fontSize || design.typography.fontSize <= 0) diagnostics.push({ code: 'FONT_SIZE', severity: 'error', message: '글자 크기가 올바르지 않습니다.' })
  return diagnostics
}

/**
 * Layout text lines uniformly fitted within the baseplate's inner margins.
 */
export function layoutText(
  font: opentype.Font,
  normalizedLines: string[],
  baseWidth: number,
  baseHeight: number,
  marginX: number,
  marginY: number,
  align: 'left' | 'center' | 'right',
  baseFontSize: number,
  secondLineScale: number = 0.65,
  lineGap: number = 3.5,
  letterSpacing: number = 0.5
): TextLayoutResult {
  const availWidth = Math.max(10, baseWidth - marginX * 2)
  const availHeight = Math.max(10, baseHeight - marginY * 2)

  // 1. Initial pass: layout at nominal font size
  interface RawLineItem {
    lineIndex: number
    characterIndex: number
    character: string
    advance: number
    contours: Vec2[][]
  }

  const rawLines: RawLineItem[][] = []
  let nominalY = 0

  normalizedLines.forEach((line, lineIndex) => {
    const lineFontSize = lineIndex === 0 ? baseFontSize : baseFontSize * secondLineScale
    const items: RawLineItem[] = []
    let cursorX = 0

    ;[...line].forEach((char, charIndex) => {
      if (char === ' ') {
        const spaceGlyph = font.charToGlyph(' ')
        const spaceAdvanceWidth = spaceGlyph?.advanceWidth ?? (font.unitsPerEm * 0.4)
        const spaceAdvance = (spaceAdvanceWidth / font.unitsPerEm) * lineFontSize + letterSpacing
        cursorX += spaceAdvance
        return
      }
      try {
        const glyph = font.charToGlyph(char)
        const advanceWidth = glyph?.advanceWidth ?? font.unitsPerEm
        const advance = (advanceWidth / font.unitsPerEm) * lineFontSize + letterSpacing
        const path = glyph.getPath(cursorX, nominalY, lineFontSize)
        const contours = flattenPath(path.commands)
        items.push({
          lineIndex,
          characterIndex: charIndex,
          character: char,
          advance,
          contours,
        })
        cursorX += advance
      } catch {
        // Skip missing glyphs safely
      }
    })
    rawLines.push(items)
    nominalY += lineFontSize + lineGap
  })

  // 2. Measure overall bounds
  let rawMinX = Infinity, rawMaxX = -Infinity
  let rawMinY = Infinity, rawMaxY = -Infinity

  rawLines.forEach((items) => {
    items.forEach((item) => {
      item.contours.forEach((ring) => {
        ring.forEach((pt) => {
          rawMinX = Math.min(rawMinX, pt.x)
          rawMaxX = Math.max(rawMaxX, pt.x)
          rawMinY = Math.min(rawMinY, pt.y)
          rawMaxY = Math.max(rawMaxY, pt.y)
        })
      })
    })
  })

  const hasContent = rawMinX !== Infinity
  const rawWidth = hasContent ? Math.max(1, rawMaxX - rawMinX) : 1
  const rawHeight = hasContent ? Math.max(1, rawMaxY - rawMinY) : 1

  // 3. Compute uniform scale
  const scaleX = availWidth / rawWidth
  const scaleY = availHeight / rawHeight
  // Limit max scale to 1.3 to avoid over-inflating short texts, but shrink as needed
  const appliedScale = Math.min(1.3, Math.min(scaleX, scaleY))

  // 4. Position and align glyphs with appliedScale
  const finalGlyphs: PositionedGlyph[] = []
  const scaledWidth = rawWidth * appliedScale
  const scaledHeight = rawHeight * appliedScale

  // Measure per-line bounds after scale
  rawLines.forEach((items) => {
    if (!items.length) return
    let lineMinX = Infinity, lineMaxX = -Infinity
    items.forEach((item) => {
      item.contours.forEach((ring) => {
        ring.forEach((pt) => {
          lineMinX = Math.min(lineMinX, pt.x * appliedScale)
          lineMaxX = Math.max(lineMaxX, pt.x * appliedScale)
        })
      })
    })
    const lineWidth = lineMaxX - lineMinX

    let alignOffset = 0
    if (align === 'center') {
      alignOffset = -lineMinX - lineWidth / 2
    } else if (align === 'left') {
      alignOffset = -lineMinX - availWidth / 2
    } else if (align === 'right') {
      alignOffset = -lineMinX + availWidth / 2 - lineWidth
    }

    const yCenterOffset = -((rawMinY + rawMaxY) / 2) * appliedScale

    items.forEach((item) => {
      const scaledContours = item.contours.map((ring) =>
        ring.map((pt) => ({
          x: pt.x * appliedScale + alignOffset,
          y: pt.y * appliedScale + yCenterOffset,
        }))
      )
      finalGlyphs.push({
        lineIndex: item.lineIndex,
        characterIndex: item.characterIndex,
        character: item.character,
        advance: item.advance * appliedScale,
        contours: scaledContours,
        x: alignOffset,
        y: yCenterOffset,
      })
    })
  })

  return {
    glyphs: finalGlyphs,
    appliedScale,
    textBounds: {
      min: { x: -scaledWidth / 2, y: -scaledHeight / 2 },
      max: { x: scaledWidth / 2, y: scaledHeight / 2 },
    },
    totalWidth: scaledWidth,
    totalHeight: scaledHeight,
  }
}

