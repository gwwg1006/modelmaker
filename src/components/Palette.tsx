export type PaletteSlot = { id: string; name: string; color: string; usage: string };

type Props = { slots: PaletteSlot[]; active: string; onSelect: (id: string) => void; onColor: (id: string, color: string) => void; usedIds: string[] };

export default function Palette({ slots, active, onSelect, onColor, usedIds }: Props) {
  return <div className="palette-grid" role="list" aria-label="필라멘트 색상 팔레트">
    {slots.map((slot, index) => <button type="button" className={`palette-card ${active === slot.id ? 'selected' : ''}`} onClick={() => onSelect(slot.id)} key={slot.id} role="listitem">
      <span className="swatch-wrap"><span className="swatch" style={{ backgroundColor: slot.color }} /><input aria-label={`${slot.name} 색상`} type="color" value={slot.color} onChange={(event) => onColor(slot.id, event.target.value)} onClick={(event) => event.stopPropagation()} /></span>
      <span className="palette-copy"><strong>{slot.name}</strong><small>{usedIds.includes(slot.id) ? slot.usage : '사용하지 않음'}</small></span>
      {index === 0 && <span className="palette-tag">받침판</span>}
    </button>)}
  </div>;
}
