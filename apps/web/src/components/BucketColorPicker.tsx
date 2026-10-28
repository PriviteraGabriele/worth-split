const colors=[
  ['#F27A65','Corallo'],['#8B7CF6','Viola'],['#3AAED8','Azzurro'],['#46C987','Verde'],
  ['#E6A44A','Ambra'],['#EA6F9A','Rosa'],['#46B7A7','Turchese'],['#8B96A8','Grigio'],
] as const;

export function BucketColorPicker({value,onChange}:{value:string;onChange:(color:string)=>void}){
  return <div className="bucket-color-picker" role="group" aria-label="Colore del bucket">{colors.map(([color,label])=><button type="button" className={`bucket-color ${value===color?'selected':''}`} style={{'--bucket-color':color} as React.CSSProperties} onClick={()=>onChange(color)} aria-label={label} aria-pressed={value===color} title={label} key={color}/>)}</div>;
}
