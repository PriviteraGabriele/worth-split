// @vitest-environment jsdom

import { act,cleanup,fireEvent,render,screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { Modal } from './Modal';

describe('Modal mobile behaviour',()=>{
  beforeEach(()=>{
    document.documentElement.dataset.mobileUi='true';
  });

  afterEach(()=>{
    cleanup();
    vi.useRealTimers();
    delete document.documentElement.dataset.mobileUi;
  });

  it('renders above the app through document.body without opening the keyboard',()=>{
    vi.useFakeTimers();
    render(<Modal title="Prova" onClose={()=>undefined}><input data-auto-focus aria-label="Campo"/></Modal>);
    act(()=>vi.runOnlyPendingTimers());

    const dialog=screen.getByRole('dialog');
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(document.activeElement).toBe(dialog);
    expect(screen.getByLabelText('Campo')).not.toHaveFocus();
  });

  it('uses the first backdrop tap to dismiss the keyboard, then closes on the following tap',()=>{
    const onClose=vi.fn();
    render(<Modal title="Prova" onClose={onClose}><input aria-label="Campo"/></Modal>);
    const field=screen.getByLabelText('Campo');
    const backdrop=screen.getByRole('dialog').parentElement!;
    field.focus();

    fireEvent.pointerDown(backdrop);
    expect(field).not.toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(backdrop);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes from the backdrop click instead of the pointer press',()=>{
    const onClose=vi.fn();
    render(<Modal title="Prova" onClose={onClose}><p>Contenuto</p></Modal>);
    const backdrop=screen.getByRole('dialog').parentElement!;

    fireEvent.pointerDown(backdrop);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps keyboard focus inside the dialog',()=>{
    vi.useFakeTimers();
    render(<Modal title="Prova" onClose={()=>undefined}><button>Prima</button><button>Ultima</button></Modal>);
    act(()=>vi.runOnlyPendingTimers());
    const dialog=screen.getByRole('dialog');

    fireEvent.keyDown(dialog,{key:'Tab'});
    expect(screen.getByRole('button',{name:'Chiudi'})).toHaveFocus();

    screen.getByRole('button',{name:'Ultima'}).focus();
    fireEvent.keyDown(document,{key:'Tab'});
    expect(screen.getByRole('button',{name:'Chiudi'})).toHaveFocus();
  });

  it('does not reset the focused field when the close callback changes',()=>{
    vi.useFakeTimers();
    const view=render(<Modal title="Prova" onClose={()=>undefined}><input aria-label="Campo"/></Modal>);
    act(()=>vi.runOnlyPendingTimers());
    const field=screen.getByLabelText('Campo');
    field.focus();

    view.rerender(<Modal title="Prova" onClose={()=>undefined}><input aria-label="Campo"/></Modal>);
    act(()=>vi.runOnlyPendingTimers());

    expect(field).toHaveFocus();
  });
});
