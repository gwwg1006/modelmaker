import { useEffect, useMemo, useRef, useState } from 'react';
import opentype from 'opentype.js';
import Preview, { RenderPart } from './components/Preview';
import Palette, { PaletteSlot } from './components/Palette';
import StatusBar from './components/StatusBar';
import Topbar from './components/Topbar';
import { parseFont, layoutText, normalizeAndValidate, ParsedFont } from './core/text';
import { roundedRectangle, extrude, groupsFromContours, ExtrudedMesh } from './core/mesh';
import { buildBambuProject3mf, ExportPart } from './core/export3mf';
import type { NameplateDesign, PrinterModel, PresetId } from './domain';

type View = 'perspective' | 'top' | 'side';

export interface AppDesignState {
  lines: string[];
  preset: PresetId;
  width: number;
  height: number;
  baseThickness: number;
  reliefHeight: number;
  radius: number;
  marginX: number;
  marginY: number;
  font: 'bold' | 'black';
  printer: PrinterModel;
  align: 'left' | 'center' | 'right';
  palette: PaletteSlot[];
  activePalette: string;
  charColors: Record<string, string>; // "line:charIndex" -> paletteSlotId
}

const initialDesign: AppDesignState = {
  lines: ['김명규크리에이티브'],
  preset: 'nameplate',
  width: 90,
  height: 32,
  baseThickness: 2.4,
  reliefHeight: 1.2,
  radius: 3,
  marginX: 5,
  marginY: 4,
  font: 'bold',
  printer: 'P2S',
  align: 'center',
  activePalette: 'text',
  charColors: {},
  palette: [
    { id: 'base', name: '남색', color: '#1B2F54', usage: '받침판' },
    { id: 'text', name: '흰색', color: '#F7F8FB', usage: '기본 글자' },
    { id: 'accent-1', name: '포인트 1', color: '#E89B52', usage: '선택 글자' },
    { id: 'accent-2', name: '포인트 2', color: '#8BB9C7', usage: '선택 글자' },
  ],
};

const storageKey = 'modelmaker:last-design:v2';

export default function App() {
  const [design, setDesign] = useState<AppDesignState>(initialDesign);
  const [saved, setSaved] = useState(true);
  const [status, setStatus] = useState('글꼴 불러오는 중...');
  const [view, setView] = useState<View>('perspective');
  const [advanced, setAdvanced] = useState(false);
  const [composing, setComposing] = useState(false);
  const [fontBold, setFontBold] = useState<ParsedFont | null>(null);
  const [fontBlack, setFontBlack] = useState<ParsedFont | null>(null);
  const [fontLoading, setFontLoading] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load OpenType fonts
  useEffect(() => {
    async function loadFonts() {
      try {
        const [boldRes, blackRes] = await Promise.all([
          fetch('/fonts/NotoSansKR-Bold.otf'),
          fetch('/fonts/NotoSansKR-Black.otf'),
        ]);
        const [boldBuf, blackBuf] = await Promise.all([
          boldRes.arrayBuffer(),
          blackRes.arrayBuffer(),
        ]);
        setFontBold(parseFont(boldBuf));
        setFontBlack(parseFont(blackBuf));
        setFontLoading(false);
        setStatus('설계 검사 통과');
      } catch (err) {
        console.error('Font load error:', err);
        setStatus('글꼴을 불러오지 못했습니다');
      }
    }
    loadFonts();
  }, []);

  // Restore design from localStorage
  useEffect(() => {
    try {
      const savedStr = localStorage.getItem(storageKey);
      if (savedStr) {
        const parsed = JSON.parse(savedStr);
        if (parsed?.lines) {
          setDesign((curr) => ({
            ...curr,
            ...parsed,
            palette: parsed.palette?.length ? parsed.palette : curr.palette,
          }));
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Persist design
  useEffect(() => {
    setSaved(false);
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(design));
      } catch {
        // ignore
      }
      setSaved(true);
    }, 400);
    return () => clearTimeout(timer);
  }, [design]);

  const activeFont = design.font === 'black' ? fontBlack : fontBold;

  // Validation
  const { normalizedLines, diagnostics } = useMemo(() => {
    return normalizeAndValidate(design.lines);
  }, [design.lines]);

  const hasError = diagnostics.some((d) => d.severity === 'error');
  const allText = design.lines.join('\n');
  const charCount = Array.from(allText.replace(/\n/g, '')).length;

  // Color mappings
  const baseColorSlot = design.palette.find((p) => p.id === 'base') || design.palette[0];
  const textColorSlot = design.palette.find((p) => p.id === 'text') || design.palette[1];

  // Palette lookup
  const paletteMap = useMemo(() => {
    const map = new Map<string, string>();
    design.palette.forEach((slot) => map.set(slot.id, slot.color));
    return map;
  }, [design.palette]);

  // Compute used filaments & colors
  const usedSlotIds = useMemo(() => {
    const ids = new Set<string>();
    ids.add('base');
    ids.add('text');
    Object.values(design.charColors).forEach((slotId) => {
      if (slotId) ids.add(slotId);
    });
    return Array.from(ids);
  }, [design.charColors]);

  const usedColorCount = usedSlotIds.length;

  // Geometry calculation
  const { baseMesh, glyphParts, layoutResult } = useMemo(() => {
    if (!activeFont || fontLoading || hasError || !allText.trim()) {
      return { baseMesh: null, glyphParts: [], layoutResult: null };
    }

    try {
      // 1. Base mesh
      const baseGroups = roundedRectangle(design.width, design.height, design.radius);
      const bMesh: ExtrudedMesh = extrude(baseGroups, 0, design.baseThickness);

      // 2. Text Layout
      const baseFontSize = design.preset === 'nameplate' ? 17 : 20;
      const layout = layoutText(
        activeFont.font,
        normalizedLines,
        design.width,
        design.height,
        design.marginX,
        design.marginY,
        design.align,
        baseFontSize,
        0.65,
        3.5,
        0.5
      );

      // 3. Extrude each glyph
      const gParts: Array<RenderPart & { filamentId: string }> = [];
      layout.glyphs.forEach((g, idx) => {
        const groups = groupsFromContours(g.contours);
        const mesh = extrude(
          groups,
          design.baseThickness,
          design.baseThickness + design.reliefHeight
        );
        const charKey = `${g.lineIndex}:${g.characterIndex}`;
        const slotId = design.charColors[charKey] || 'text';
        const color = paletteMap.get(slotId) || textColorSlot.color;

        gParts.push({
          id: 3 + idx,
          name: `Glyph_${g.character}_${g.lineIndex}_${g.characterIndex}`,
          mesh,
          color,
          filamentId: slotId,
        });
      });

      return { baseMesh: bMesh, glyphParts: gParts, layoutResult: layout };
    } catch (e) {
      console.error('Geometry calculation error:', e);
      return { baseMesh: null, glyphParts: [], layoutResult: null };
    }
  }, [
    activeFont,
    fontLoading,
    hasError,
    allText,
    design.width,
    design.height,
    design.radius,
    design.baseThickness,
    design.reliefHeight,
    design.marginX,
    design.marginY,
    design.align,
    design.preset,
    normalizedLines,
    design.charColors,
    paletteMap,
    textColorSlot.color,
  ]);

  const patch = (changes: Partial<AppDesignState>) => setDesign((curr) => ({ ...curr, ...changes }));

  const selectPreset = (preset: PresetId) => {
    if (preset === 'nameplate') {
      patch({ preset, width: 90, height: 32, radius: 3, marginX: 5, marginY: 4 });
    } else {
      patch({ preset, width: 160, height: 48, radius: 4, marginX: 6, marginY: 5 });
    }
  };

  const onTextChange = (value: string) => {
    const lines = value.split('\n').slice(0, 2);
    patch({ lines });
    setStatus('모양 만드는 중...');
    setTimeout(() => {
      setStatus('설계 검사 통과');
    }, 200);
  };

  const updatePalette = (id: string, color: string) => {
    patch({
      palette: design.palette.map((slot) => (slot.id === id ? { ...slot, color } : slot)),
    });
  };

  const toggleCharColor = (charKey: string) => {
    const currentColor = design.charColors[charKey];
    const targetColor = design.activePalette;

    if (currentColor === targetColor || targetColor === 'text') {
      // Reset to default text color
      const updated = { ...design.charColors };
      delete updated[charKey];
      patch({ charColors: updated });
    } else {
      patch({
        charColors: { ...design.charColors, [charKey]: targetColor },
      });
    }
  };

  const resetCharColors = () => {
    patch({ charColors: {} });
  };

  const downloadJson = () => {
    const blob = new Blob(
      [JSON.stringify({ format: 'modelmaker-design', version: 2, savedAt: new Date().toISOString(), design }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `modelmaker-${design.lines.filter(Boolean).join('-') || 'design'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadFile = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (parsed?.design?.lines) {
          setDesign({ ...initialDesign, ...parsed.design });
          setStatus('디자인 파일을 불러왔습니다');
        }
      } catch {
        setStatus('디자인 파일을 읽지 못했습니다');
      }
    };
    reader.readAsText(file);
  };

  const generate3mf = () => {
    if (!baseMesh || !glyphParts.length || hasError) return;

    setStatus('3MF 파일 생성 중...');

    try {
      const exportGlyphs: ExportPart[] = glyphParts.map((p) => ({
        id: p.id,
        name: p.name,
        mesh: p.mesh,
        filamentId: p.filamentId,
      }));

      const domainDesign: NameplateDesign = {
        schemaVersion: 1,
        id: `design-${Date.now()}`,
        title: `명패_${design.lines.join('_')}`,
        lines: design.lines,
        preset: design.preset,
        printer: design.printer,
        filaments: design.palette.map((p) => ({
          id: p.id,
          name: p.name,
          hex: p.color,
          material: 'PLA',
        })),
        base: {
          width: design.width,
          height: design.height,
          thickness: design.baseThickness,
          cornerRadius: design.radius,
          marginX: design.marginX,
          marginY: design.marginY,
          filamentId: 'base',
        },
        typography: {
          fontId: design.font === 'black' ? 'noto-sans-kr-black' : 'noto-sans-kr-bold',
          lineAlign: design.align,
          fontSize: design.preset === 'nameplate' ? 17 : 20,
          secondLineScale: 0.65,
          lineGap: 3.5,
          letterSpacing: 0.5,
          embossHeight: design.reliefHeight,
          defaultFilamentId: 'text',
          characterFilamentIds: design.charColors,
        },
      };

      const bytes = buildBambuProject3mf({
        design: domainDesign,
        baseMesh,
        glyphParts: exportGlyphs,
        printer: design.printer,
      });

      const blob = new Blob([bytes.buffer as ArrayBuffer], {
        type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
      });
      const cleanTitle = design.lines.filter(Boolean).join('_') || '이름표';
      const filename = `명패_${cleanTitle}_${design.printer}_${design.width}x${design.height}_${usedColorCount}색.3mf`;

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);

      setStatus(`저장 완료: ${filename}`);
    } catch (err) {
      console.error('Export error:', err);
      setStatus('3MF 파일 생성에 실패했습니다');
    }
  };

  const valid = !hasError && charCount > 0 && !composing && !fontLoading;

  return (
    <div className="app-shell">
      <Topbar
        saved={saved}
        onNew={() => setDesign(initialDesign)}
        onSave={downloadJson}
        onLoad={() => fileRef.current?.click()}
      />
      <input
        ref={fileRef}
        className="visually-hidden"
        type="file"
        accept="application/json,.json"
        onChange={(e) => loadFile(e.target.files?.[0])}
      />

      <main className="workspace">
        {/* Left Panel: Text & Product Shape */}
        <aside className="panel left-panel">
          <div className="panel-heading">
            <span className="eyebrow">01 · 디자인</span>
            <h1>문구와 모양</h1>
            <p>이름을 입력하면 글자가 받침판 위에 맞춰집니다.</p>
          </div>

          <label className="field-label" htmlFor="copy">
            표시할 문구 <span>{charCount}/40</span>
          </label>
          <textarea
            id="copy"
            className={`copy-input ${hasError ? 'has-error' : ''}`}
            value={allText}
            onChange={(e) => onTextChange(e.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(e) => {
              setComposing(false);
              onTextChange(e.currentTarget.value);
            }}
            rows={3}
            placeholder="이름이나 문구를 입력하세요"
            aria-describedby="copy-hint"
          />
          <div id="copy-hint" className="field-hint">
            최대 2줄 · 한 줄 24글자 · 한글, 영문, 숫자
          </div>

          {diagnostics.map((d, i) => (
            <div key={i} className="error-note">
              {d.message}
            </div>
          ))}

          {/* Character Color Strip */}
          {valid && (
            <div style={{ marginTop: '16px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px',
                }}
              >
                <span className="field-label" style={{ margin: 0 }}>
                  글자별 포인트 색상 지정
                </span>
                {Object.keys(design.charColors).length > 0 && (
                  <button
                    type="button"
                    onClick={resetCharColors}
                    style={{
                      border: 0,
                      background: 'none',
                      color: '#8b9bb0',
                      fontSize: '10px',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    색상 초기화
                  </button>
                )}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '5px',
                  background: '#f3f6fa',
                  padding: '8px',
                  borderRadius: '8px',
                  border: '1px solid #e1e7f0',
                }}
              >
                {normalizedLines.map((line, lIdx) =>
                  [...line].map((ch, cIdx) => {
                    if (ch === ' ') return null;
                    const key = `${lIdx}:${cIdx}`;
                    const slotId = design.charColors[key] || 'text';
                    const color = paletteMap.get(slotId) || textColorSlot.color;
                    const isCustom = slotId !== 'text';
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleCharColor(key)}
                        title={`'${ch}' 색상: ${slotId} (클릭하여 팔레트 색상 적용)`}
                        style={{
                          border: isCustom ? '2px solid #2d4770' : '1px solid #c9d4e2',
                          borderRadius: '6px',
                          background: '#ffffff',
                          padding: '4px 7px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: 700,
                          color: '#1a2840',
                        }}
                      >
                        <span
                          style={{
                            width: '10px',
                            height: '10px',
                            borderRadius: '50%',
                            backgroundColor: color,
                            border: '1px solid rgba(0,0,0,0.15)',
                            display: 'inline-block',
                          }}
                        />
                        {ch}
                      </button>
                    );
                  })
                )}
              </div>
              <div style={{ fontSize: '9px', color: '#8898aa', marginTop: '4px' }}>
                오른쪽 팔레트에서 색을 고른 뒤 글자를 클릭하면 해당 색으로 배정됩니다.
              </div>
            </div>
          )}

          <div className="section-divider" />

          <span className="field-label">제품 종류</span>
          <div className="segmented">
            <button
              className={design.preset === 'nameplate' ? 'active' : ''}
              type="button"
              onClick={() => selectPreset('nameplate')}
            >
              <span className="preset-icon small" />
              이름표 <small>90 × 32</small>
            </button>
            <button
              className={design.preset === 'plaque' ? 'active' : ''}
              type="button"
              onClick={() => selectPreset('plaque')}
            >
              <span className="preset-icon wide" />
              명패 <small>160 × 48</small>
            </button>
          </div>

          <div className="field-row">
            <label className="field-label" htmlFor="font">
              글꼴
            </label>
            <select
              id="font"
              value={design.font}
              onChange={(e) => patch({ font: e.target.value as 'bold' | 'black' })}
            >
              <option value="bold">Noto Sans KR · Bold</option>
              <option value="black">Noto Sans KR · Black</option>
            </select>
          </div>

          <div className="field-row">
            <span className="field-label">정렬</span>
            <div className="align-buttons" role="group" aria-label="문구 정렬">
              <button
                className={design.align === 'left' ? 'active' : ''}
                type="button"
                onClick={() => patch({ align: 'left' })}
              >
                왼쪽
              </button>
              <button
                className={design.align === 'center' ? 'active' : ''}
                type="button"
                onClick={() => patch({ align: 'center' })}
              >
                가운데
              </button>
              <button
                className={design.align === 'right' ? 'active' : ''}
                type="button"
                onClick={() => patch({ align: 'right' })}
              >
                오른쪽
              </button>
            </div>
          </div>

          <button
            className="advanced-toggle"
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            aria-expanded={advanced}
          >
            <span>세부 설정</span>
            <span>{advanced ? '−' : '+'}</span>
          </button>

          {advanced && (
            <div className="advanced-fields">
              <label>
                받침판 가로 <output>{design.width} mm</output>
                <input
                  type="range"
                  min="50"
                  max="220"
                  step="2"
                  value={design.width}
                  onChange={(e) => patch({ width: Number(e.target.value) })}
                />
              </label>
              <label>
                받침판 세로 <output>{design.height} mm</output>
                <input
                  type="range"
                  min="24"
                  max="80"
                  step="2"
                  value={design.height}
                  onChange={(e) => patch({ height: Number(e.target.value) })}
                />
              </label>
              <label>
                받침판 두께 <output>{design.baseThickness.toFixed(1)} mm</output>
                <input
                  type="range"
                  min="1.6"
                  max="4"
                  step="0.2"
                  value={design.baseThickness}
                  onChange={(e) => patch({ baseThickness: Number(e.target.value) })}
                />
              </label>
              <label>
                글자 돌출 높이 <output>{design.reliefHeight.toFixed(1)} mm</output>
                <input
                  type="range"
                  min="0.6"
                  max="2"
                  step="0.2"
                  value={design.reliefHeight}
                  onChange={(e) => patch({ reliefHeight: Number(e.target.value) })}
                />
              </label>
            </div>
          )}
        </aside>

        {/* Center: 3D Preview Panel */}
        <section className="preview-panel">
          <div className="preview-toolbar">
            <div>
              <span className="eyebrow">미리보기</span>
              <h2>실제 형상 기반 실시간 3D</h2>
            </div>
            <div className="view-actions">
              <button
                className={view === 'perspective' ? 'active' : ''}
                type="button"
                onClick={() => setView('perspective')}
              >
                사선
              </button>
              <button
                className={view === 'top' ? 'active' : ''}
                type="button"
                onClick={() => setView('top')}
              >
                위에서
              </button>
              <button
                className={view === 'side' ? 'active' : ''}
                type="button"
                onClick={() => setView('side')}
              >
                옆에서
              </button>
            </div>
          </div>

          <div className="preview-stage">
            <Preview
              width={design.width}
              height={design.height}
              baseColor={baseColorSlot.color}
              baseMesh={baseMesh}
              glyphParts={glyphParts}
              view={view}
            />
            <div className="preview-scale">
              <span>
                마우스로 3D 회전 가능 · 자동 맞춤 배율:{' '}
                {layoutResult ? `${(layoutResult.appliedScale * 100).toFixed(0)}%` : '100%'}
              </span>
              <span className="scale-line" />
            </div>
          </div>

          <div className="dimension-row">
            <div>
              <span>가로</span>
              <strong>
                {design.width} <small>mm</small>
              </strong>
            </div>
            <div>
              <span>세로</span>
              <strong>
                {design.height} <small>mm</small>
              </strong>
            </div>
            <div>
              <span>총 높이</span>
              <strong>
                {(design.baseThickness + design.reliefHeight).toFixed(1)} <small>mm</small>
              </strong>
            </div>
            <div className="preview-note">
              <span className="info-mark">i</span>
              <span>출력될 3MF와 100% 동일한 Noto Sans KR 윤곽선으로 생성된 입체 형상입니다.</span>
            </div>
          </div>
        </section>

        {/* Right Panel: Colors & Printer */}
        <aside className="panel right-panel">
          <div className="panel-heading">
            <span className="eyebrow">02 · 출력 준비</span>
            <h2>색상과 기종</h2>
            <p>받침판과 글자에 사용할 필라멘트를 정합니다.</p>
          </div>

          <span className="field-label">
            팔레트 <span>{usedColorCount}/4색 사용 중</span>
          </span>
          <Palette
            slots={design.palette}
            active={design.activePalette}
            onSelect={(id) => patch({ activePalette: id })}
            onColor={updatePalette}
            usedIds={usedSlotIds}
          />

          <div className="section-divider" />

          <span className="field-label">출력 기종</span>
          <div className="printer-cards">
            <button
              type="button"
              className={design.printer === 'P2S' ? 'active' : ''}
              onClick={() => patch({ printer: 'P2S' })}
            >
              <span className="printer-name">P2S</span>
              <span>256 × 256 × 256 mm</span>
              <i>지원 프로필</i>
            </button>
            <button
              type="button"
              className={design.printer === 'H2S' ? 'active' : ''}
              onClick={() => patch({ printer: 'H2S' })}
            >
              <span className="printer-name">H2S</span>
              <span>340 × 320 × 340 mm</span>
              <i>지원 프로필</i>
            </button>
          </div>

          <div className="settings-summary">
            <div>
              <span>노즐</span>
              <strong>0.4 mm</strong>
            </div>
            <div>
              <span>재료</span>
              <strong>PLA</strong>
            </div>
            <div>
              <span>레이어</span>
              <strong>0.20 mm</strong>
            </div>
          </div>

          <div className="studio-tip">
            <span className="tip-icon">✦</span>
            <p>
              다운로드한 3MF를 Bambu Studio에서 ‘프로젝트로 열기’하면 색상 재지정 없이 바로 슬라이싱할 수 있습니다.
            </p>
          </div>
        </aside>
      </main>

      <StatusBar
        status={valid ? status : hasError ? '수정 필요' : '입력 대기'}
        valid={valid}
        width={design.width}
        height={design.height}
        colorCount={usedColorCount}
        disabled={!valid}
        onGenerate={generate3mf}
      />
    </div>
  );
}
