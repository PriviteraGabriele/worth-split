import type { Bucket } from '../types';
import { formatEuro } from '../lib/money';
import { useAmountPrivacy } from '../lib/amountPrivacyContext';
import { Modal } from './Modal';
import { BucketSquare } from './BucketSquare';

/** Sheet for choosing a bucket; the excluded one (e.g. the other side of a transfer) is disabled. */
export function BucketPicker({title,buckets,selected,disabledId,onSelect,onClose}:{title:string;buckets:Bucket[];selected?:string;disabledId?:string;onSelect:(id:string)=>void;onClose:()=>void}){
  const {hidden}=useAmountPrivacy();
  return <Modal title={title} onClose={onClose}><div className="sheet-list">{buckets.map(bucket=><button key={bucket.id} type="button" className="sheet-option" aria-pressed={bucket.id===selected} disabled={bucket.id===disabledId} onClick={()=>{onSelect(bucket.id);onClose()}}>
    <BucketSquare type={bucket.type} color={bucket.color}/>
    <span>{bucket.name}<small>{formatEuro(bucket.balanceCents,hidden)}</small></span>
  </button>)}</div></Modal>;
}
