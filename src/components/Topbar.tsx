type Props = { saved: boolean; onNew: () => void; onSave: () => void; onLoad: () => void };
export default function Topbar({ saved, onNew, onSave, onLoad }: Props) {
  return <header className="topbar"><div className="brand"><span className="brand-mark">M</span><span><strong>Modelmaker</strong><small>이름표 · 명패 제작</small></span></div><div className="top-actions"><span className="save-state"><span className="save-dot" />{saved ? '자동 저장됨' : '저장 중…'}</span><button type="button" className="ghost-button" onClick={onNew}>새 디자인</button><button type="button" className="ghost-button" onClick={onLoad}>불러오기</button><button type="button" className="ghost-button dark" onClick={onSave}>디자인 저장</button></div></header>;
}
