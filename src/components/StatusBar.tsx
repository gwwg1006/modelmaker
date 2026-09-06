type Props = { status: string; valid: boolean; width: number; height: number; colorCount: number; onGenerate: () => void; disabled: boolean };
export default function StatusBar({ status, valid, width, height, colorCount, onGenerate, disabled }: Props) {
  return <footer className="status-bar">
    <div className="status-summary"><span className={`status-dot ${valid ? 'ok' : 'warn'}`} /><strong>{status}</strong><span className="status-divider" /><span>실제 크기 {width} × {height} mm</span><span className="status-divider" /><span>{colorCount}색 사용</span></div>
    <button className="primary-action" type="button" disabled={disabled} onClick={onGenerate}><span className="download-icon">↓</span> 3MF 만들기</button>
  </footer>;
}
