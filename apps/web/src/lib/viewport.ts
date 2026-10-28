const MOBILE_WIDTH = 767;
const PHONE_SHORT_EDGE = 600;

type MobileLayoutInput = {
  viewportWidth: number;
  screenWidth: number;
  screenHeight: number;
  coarsePointer: boolean;
};

export function shouldUseMobileUi({ viewportWidth, screenWidth, screenHeight, coarsePointer }: MobileLayoutInput) {
  const shortScreenEdge = Math.min(screenWidth || viewportWidth, screenHeight || viewportWidth);
  return viewportWidth <= MOBILE_WIDTH || (coarsePointer && shortScreenEdge <= PHONE_SHORT_EDGE);
}

export function isAndroidUserAgent(userAgent: string) {
  return /\bAndroid\b/i.test(userAgent);
}

export function isEditableElement(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.matches('textarea, select, [contenteditable="true"]')) return true;
  return element.matches('input:not([type="hidden"]):not([disabled]):not([readonly])');
}

function revealFocusedControl(targetWindow: Window, targetDocument: Document) {
  const active = targetDocument.activeElement;
  if (!isEditableElement(active) || typeof active.scrollIntoView !== 'function') return;

  const viewport = targetWindow.visualViewport;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportBottom = viewportTop + (viewport?.height ?? targetWindow.innerHeight);
  const rect = active.getBoundingClientRect();
  const topGuard = viewportTop + 72;
  const bottomGuard = viewportBottom - 24;

  if (rect.top < topGuard || rect.bottom > bottomGuard) {
    active.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
  }
}

/**
 * Keeps CSS informed about the real visual viewport. On iOS the software keyboard
 * changes and pans this viewport without reliably changing `vh`/`dvh`.
 */
export function installViewportEnvironment(targetWindow: Window = window, targetDocument: Document = document) {
  const root = targetDocument.documentElement;
  const viewport = targetWindow.visualViewport;
  const coarsePointer = targetWindow.matchMedia?.('(hover: none) and (pointer: coarse)');
  const android = isAndroidUserAgent(targetWindow.navigator.userAgent);
  let animationFrame = 0;
  let revealTimer = 0;

  const measure = () => {
    animationFrame = 0;
    const visualWidth = viewport?.width ?? targetWindow.innerWidth;
    const visualHeight = viewport?.height ?? targetWindow.innerHeight;
    const offsetTop = viewport?.offsetTop ?? 0;
    const offsetLeft = viewport?.offsetLeft ?? 0;
    const mobileUi = shouldUseMobileUi({
      viewportWidth: targetWindow.innerWidth,
      screenWidth: targetWindow.screen?.width ?? targetWindow.innerWidth,
      screenHeight: targetWindow.screen?.height ?? targetWindow.innerHeight,
      coarsePointer: coarsePointer?.matches ?? false,
    });
    const keyboardOpen = mobileUi && isEditableElement(targetDocument.activeElement);

    root.dataset.mobileUi = String(mobileUi);
    root.dataset.keyboardOpen = String(keyboardOpen);
    root.dataset.android = String(android);
    root.style.setProperty('--visual-viewport-width', `${visualWidth.toFixed(2)}px`);
    root.style.setProperty('--visual-viewport-height', `${visualHeight.toFixed(2)}px`);
    root.style.setProperty('--visual-viewport-top', `${offsetTop.toFixed(2)}px`);
    root.style.setProperty('--visual-viewport-left', `${offsetLeft.toFixed(2)}px`);
    root.style.setProperty('--layout-viewport-height', `${targetWindow.innerHeight}px`);

    if (keyboardOpen) {
      targetWindow.clearTimeout(revealTimer);
      revealTimer = targetWindow.setTimeout(() => revealFocusedControl(targetWindow, targetDocument), 80);
    }
  };

  const scheduleMeasure = () => {
    if (animationFrame) targetWindow.cancelAnimationFrame(animationFrame);
    animationFrame = targetWindow.requestAnimationFrame(measure);
  };
  const handleFocus = () => {
    scheduleMeasure();
    targetWindow.clearTimeout(revealTimer);
    revealTimer = targetWindow.setTimeout(() => {
      measure();
      revealFocusedControl(targetWindow, targetDocument);
    }, 280);
  };

  measure();
  targetWindow.addEventListener('resize', scheduleMeasure, { passive: true });
  targetWindow.addEventListener('orientationchange', scheduleMeasure, { passive: true });
  viewport?.addEventListener('resize', scheduleMeasure, { passive: true });
  viewport?.addEventListener('scroll', scheduleMeasure, { passive: true });
  viewport?.addEventListener('scrollend', scheduleMeasure, { passive: true });
  if(typeof coarsePointer?.addEventListener==='function')coarsePointer.addEventListener('change',scheduleMeasure);
  else coarsePointer?.addListener(scheduleMeasure);
  targetDocument.addEventListener('focusin', handleFocus);
  targetDocument.addEventListener('focusout', handleFocus);

  return () => {
    if (animationFrame) targetWindow.cancelAnimationFrame(animationFrame);
    targetWindow.clearTimeout(revealTimer);
    targetWindow.removeEventListener('resize', scheduleMeasure);
    targetWindow.removeEventListener('orientationchange', scheduleMeasure);
    viewport?.removeEventListener('resize', scheduleMeasure);
    viewport?.removeEventListener('scroll', scheduleMeasure);
    viewport?.removeEventListener('scrollend', scheduleMeasure);
    if(typeof coarsePointer?.removeEventListener==='function')coarsePointer.removeEventListener('change',scheduleMeasure);
    else coarsePointer?.removeListener(scheduleMeasure);
    targetDocument.removeEventListener('focusin', handleFocus);
    targetDocument.removeEventListener('focusout', handleFocus);
  };
}
