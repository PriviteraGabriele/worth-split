import type { PlannedExpense,PlannedExpenseBase } from '../types';

const monthFormatter=new Intl.DateTimeFormat('it-IT',{month:'long',year:'numeric'});
const monthNameFormatter=new Intl.DateTimeFormat('it-IT',{month:'long'});
const shortMonthFormatter=new Intl.DateTimeFormat('it-IT',{month:'short'});
const dateFormatter=new Intl.DateTimeFormat('it-IT',{day:'numeric',month:'short'});

export function todayMonth(){const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`}
export function shiftMonth(value:string,direction:number){
  const [year,month]=value.split('-').map(Number);
  const date=new Date(year??0,(month??1)-1+direction,1);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
}
function monthDate(value:string){return new Date(`${value}-01T12:00:00`)}
export function formatMonth(value:string){return capitalize(monthFormatter.format(monthDate(value)))}
export function monthName(value:string){return capitalize(monthNameFormatter.format(monthDate(value)))}
export function shortMonth(value:string){return capitalize(shortMonthFormatter.format(monthDate(value)).replace('.',''))}
export function capitalize(value:string){return value.charAt(0).toUpperCase()+value.slice(1)}
export function daysInMonth(value:string){const [year,month]=value.split('-').map(Number);return new Date(year??0,month??1,0).getDate()}

/**
 * Amount still to pay for an occurrence. For an open estimate it is the
 * residual (estimate minus recorded charges, never negative).
 */
export function pendingAmount(expense:PlannedExpense){
  const planned=BigInt(expense.amountCents);
  if(expense.status!=='open'||expense.amountMode!=='estimated')return planned;
  const remaining=planned-BigInt(expense.actualAmountCents);
  return remaining>0n?remaining:0n;
}

/** Sorts open expenses by the residual still due, largest first. */
export function byPendingDescending(left:PlannedExpense,right:PlannedExpense){
  const difference=pendingAmount(right)-pendingAmount(left);
  return difference>0n?1:difference<0n?-1:left.name.localeCompare(right.name);
}

/** Day of the month the occurrence falls on, or null when only the month is known. */
export function dueDayOf(expense:Pick<PlannedExpenseBase,'frequency'|'dueRule'|'dueDay'|'dueDate'>,month:string){
  // A materialized occurrence carries its original due date.
  if(expense.dueDate)return Number(expense.dueDate.slice(8,10));
  const last=daysInMonth(month);
  if(expense.dueRule==='start')return 1;
  if(expense.dueRule==='mid')return 15;
  if(expense.dueRule==='end')return last;
  if(expense.dueRule==='exact'&&expense.dueDay)return Math.min(expense.dueDay,last);
  return null;
}

export function dueDescription(expense:Pick<PlannedExpenseBase,'frequency'|'dueRule'|'dueDay'|'dueDate'>){
  if(expense.dueDate)return dateFormatter.format(new Date(`${expense.dueDate}T12:00:00`)).replace('.','');
  if(expense.dueRule==='month')return 'nel mese';
  if(expense.dueRule==='start')return 'inizio mese';
  if(expense.dueRule==='mid')return 'metà mese';
  if(expense.dueRule==='end')return 'fine mese';
  if(expense.frequency!=='once')return `giorno ${expense.dueDay??1}`;
  return 'data da definire';
}

export const categoryLabels={subscription:'Abbonamento',installment:'Acquisto a rate',one_time:'Una tantum',other:'Altro'} as const;
export const frequencyLabels={monthly:'Mensile',bimonthly:'Bimestrale',quarterly:'Trimestrale',semiannual:'Semestrale',annual:'Annuale',once:'Una tantum'} as const;
export function categoryLabel(category:PlannedExpenseBase['category']){return categoryLabels[category]}
export function frequencyLabel(frequency:PlannedExpenseBase['frequency']){return frequencyLabels[frequency]}

export type BucketExpenseGroup={bucketId:string;bucketName:string;bucketColor:string|null;expenses:PlannedExpense[];total:bigint};

export function bucketGroups(expenses:PlannedExpense[],amount:(expense:PlannedExpense)=>bigint):BucketExpenseGroup[]{
  const groups=new Map<string,BucketExpenseGroup>();
  for(const expense of expenses){
    const group=groups.get(expense.bucketId)??{bucketId:expense.bucketId,bucketName:expense.bucketName,bucketColor:expense.bucketColor,expenses:[],total:0n};
    group.expenses.push(expense);
    group.total+=amount(expense);
    groups.set(expense.bucketId,group);
  }
  return [...groups.values()].sort((left,right)=>right.total>left.total?1:right.total<left.total?-1:left.bucketName.localeCompare(right.bucketName));
}

/** Month totals shared by the planned-expenses page and the home summary. */
export function plannedSummary(expenses:PlannedExpense[]){
  const open=expenses.filter(expense=>expense.status==='open');
  const pendingIncluded=open.filter(expense=>expense.includedInEstimatedTotal);
  const registered=expenses.filter(expense=>BigInt(expense.actualAmountCents)!==0n);
  return {
    open,
    pendingIncluded,
    registered,
    completed:expenses.filter(expense=>expense.status==='completed'),
    pending:pendingIncluded.reduce((sum,expense)=>sum+pendingAmount(expense),0n),
    actual:expenses.reduce((sum,expense)=>sum+BigInt(expense.actualAmountCents),0n),
  };
}
