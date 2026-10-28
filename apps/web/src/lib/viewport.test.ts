import { describe,expect,it } from 'vitest';
import { isAndroidUserAgent,shouldUseMobileUi } from './viewport';

describe('shouldUseMobileUi',()=>{
  it('uses the mobile shell for narrow portrait viewports',()=>{
    expect(shouldUseMobileUi({viewportWidth:402,screenWidth:402,screenHeight:874,coarsePointer:true})).toBe(true);
  });

  it('keeps a phone in the mobile shell when rotated to landscape',()=>{
    expect(shouldUseMobileUi({viewportWidth:874,screenWidth:402,screenHeight:874,coarsePointer:true})).toBe(true);
  });

  it('does not classify a wide desktop or tablet layout as a phone',()=>{
    expect(shouldUseMobileUi({viewportWidth:1280,screenWidth:1440,screenHeight:900,coarsePointer:false})).toBe(false);
    expect(shouldUseMobileUi({viewportWidth:1024,screenWidth:768,screenHeight:1024,coarsePointer:true})).toBe(false);
  });

  it('supports responsive mobile previews even without a coarse pointer',()=>{
    expect(shouldUseMobileUi({viewportWidth:375,screenWidth:1440,screenHeight:900,coarsePointer:false})).toBe(true);
  });

  it('identifies Android browsers for the narrow-phone layout correction',()=>{
    expect(isAndroidUserAgent('Mozilla/5.0 (Linux; Android 16; SM-S948B) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36')).toBe(true);
    expect(isAndroidUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/140 Mobile/15E148 Safari/604.1')).toBe(false);
  });
});
