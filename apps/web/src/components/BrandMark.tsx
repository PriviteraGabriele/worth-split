/** WorthSplit logo: four bars drawing a W, the third one in lime. */
export function BrandMark({className,label}:{className?:string;label?:string}){
  return <svg className={`brand-logo${className?` ${className}`:''}`} viewBox="0 0 100 100" role={label?'img':undefined} aria-label={label} aria-hidden={label?undefined:true}>
    <rect className="brand-logo-tile" width="100" height="100" rx="24"/>
    <rect className="brand-logo-bar" x="18.5" y="26" width="12" height="48" rx="6"/>
    <rect className="brand-logo-bar" x="35.5" y="44" width="12" height="30" rx="6"/>
    <rect className="brand-logo-accent" x="52.5" y="34" width="12" height="40" rx="6"/>
    <rect className="brand-logo-bar" x="69.5" y="26" width="12" height="48" rx="6"/>
  </svg>;
}
