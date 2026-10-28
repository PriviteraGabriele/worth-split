import { useState,type FormEvent } from 'react';
import { useMutation,useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Bucket,Dashboard } from '../types';
import { Modal } from './Modal';
import { BucketSquare } from './BucketSquare';
import { BucketColorPicker } from './BucketColorPicker';

const choices=[['💳','spending','#F27A65'],['💰','saving','#8B7CF6'],['📈','investment','#3AAED8'],['✨','other','#E6A44A']] as const;
type Choice=(typeof choices)[number];
type BucketInput=Pick<Bucket,'name'|'type'|'icon'|'color'|'monthlyTargetCents'> & {description:string|null};

export function BucketForm({onClose}:{onClose:()=>void}){
  const qc=useQueryClient();
  const [choice,setChoice]=useState<Choice>(choices[0]);
  const [color,setColor]=useState<string>(choice[2]);
  const mutation=useMutation({
    mutationFn:(body:BucketInput)=>api<{id:string}>('/buckets',{method:'POST',body:JSON.stringify(body)}),
    onSuccess:(result,input)=>{
      qc.setQueryData<Dashboard>(['dashboard'],current=>{
        if(!current)return current;
        const sortOrder=Math.max(-1,...current.buckets.map(bucket=>bucket.sortOrder))+1;
        const bucket:Bucket={
          ...input,
          id:result.id,
          description:input.description??undefined,
          balanceCents:'0',
          monthlyChangeCents:'0',
          currency:'EUR',
          sortOrder,
          includeInTotal:true,
        };
        return {...current,buckets:[...current.buckets,bucket]};
      });
      void qc.invalidateQueries({queryKey:['dashboard']});
      void qc.invalidateQueries({queryKey:['trends']});
      onClose();
    },
  });

  function selectChoice(next:Choice){setChoice(next);setColor(next[2])}

  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    mutation.mutate({
      name:String(form.get('name')??''),
      description:String(form.get('description')??'')||null,
      type:choice[1],
      icon:choice[0],
      color,
      monthlyTargetCents:null,
    });
  }

  return <Modal title="Nuovo bucket" onClose={onClose}><form className="stack" onSubmit={submit}><label>Nome<input name="name" placeholder="Es. Fondo emergenza" maxLength={60} required data-auto-focus enterKeyHint="next"/></label><label>Descrizione<textarea name="description" maxLength={300}/></label><fieldset><legend>Tipo e stile</legend><div className="choice-row">{choices.map(item=><button type="button" className={choice===item?'choice selected':'choice'} key={item[1]} onClick={()=>selectChoice(item)}><BucketSquare type={item[1]} color={color} size={34}/><strong>{({spending:'Spese',saving:'Risparmio',investment:'Investimento',other:'Altro'} as const)[item[1]]}</strong></button>)}</div></fieldset><fieldset><legend>Colore</legend><BucketColorPicker value={color} onChange={setColor}/></fieldset>{mutation.isError&&<p className="form-error">Impossibile creare il bucket.</p>}<button className="primary" disabled={mutation.isPending}>{mutation.isPending?'Creazione…':'Crea bucket'}</button></form></Modal>;
}
