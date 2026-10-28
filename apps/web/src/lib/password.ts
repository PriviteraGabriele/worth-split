// No 0/O, 1/l/I: temporary passwords are often read aloud or retyped.
const alphabet='abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Random temporary password in dash-separated groups, e.g. "K7mq-P4xW-9tzR-b3Nc". */
export function generatePassword(groups=4,groupLength=4){
  const chars:string[]=[];
  const limit=256-(256%alphabet.length);
  while(chars.length<groups*groupLength){
    const bytes=crypto.getRandomValues(new Uint8Array(32));
    for(const byte of bytes){
      // Rejection sampling keeps every character equally likely.
      if(byte<limit&&chars.length<groups*groupLength)chars.push(alphabet[byte%alphabet.length]!);
    }
  }
  return Array.from({length:groups},(_,index)=>chars.slice(index*groupLength,(index+1)*groupLength).join('')).join('-');
}

export const MIN_PASSWORD_LENGTH=12;
const strengthLabels=['Troppo corta','Debole','Discreta','Buona','Ottima'] as const;

/** Rough 0–4 score used only for the visual meter; the server enforces the real rules. */
export function passwordStrength(value:string){
  if(value.length<MIN_PASSWORD_LENGTH)return {score:0,label:strengthLabels[0]};
  let score=1;
  if(value.length>=16)score++;
  if(/[a-z]/.test(value)&&/[A-Z]/.test(value)&&/\d/.test(value))score++;
  if(/[^A-Za-z0-9]/.test(value))score++;
  return {score,label:strengthLabels[score]!};
}
