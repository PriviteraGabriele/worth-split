const SIZE=512;
// The API accepts up to 512 KB; base64 adds a third on top of the bytes.
const MAX_DATA_URL_LENGTH=Math.floor(512*1024*4/3);

/**
 * Crops the chosen picture to a centred square and resizes it to 512 px,
 * returning a JPEG data URL small enough for the profile photo endpoint.
 */
export async function prepareAvatar(file:File):Promise<string>{
  if(!file.type.startsWith('image/'))throw new Error('Scegli un file immagine.');
  const bitmap=await createImageBitmap(file);
  try{
    const side=Math.min(bitmap.width,bitmap.height);
    const canvas=document.createElement('canvas');
    canvas.width=SIZE;canvas.height=SIZE;
    const context=canvas.getContext('2d');
    if(!context)throw new Error('Il browser non può elaborare l’immagine.');
    context.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,SIZE,SIZE);
    for(const quality of [0.86,0.75,0.6]){
      const dataUrl=canvas.toDataURL('image/jpeg',quality);
      if(dataUrl.length<=MAX_DATA_URL_LENGTH)return dataUrl;
    }
    throw new Error('L’immagine è troppo pesante.');
  }finally{bitmap.close()}
}
