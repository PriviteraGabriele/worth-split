// @vitest-environment jsdom

import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { TextInputModal } from './TextInputModal';

describe('TextInputModal validation',()=>{
  afterEach(cleanup);

  it('explains the minimum password length and blocks an invalid submission',async()=>{
    const onSubmit=vi.fn();
    render(<TextInputModal title="Esporta backup" label="Password di cifratura" type="password" minLength={12} submitLabel="Esporta" onSubmit={onSubmit} onClose={()=>undefined}/>);
    const input=screen.getByLabelText('Password di cifratura');

    fireEvent.change(input,{target:{value:'prova123'}});
    expect(screen.getByRole('alert')).toHaveTextContent('La password deve contenere almeno 12 caratteri.');
    expect(input).toHaveAttribute('aria-invalid','true');

    fireEvent.click(screen.getByRole('button',{name:'Esporta'}));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(input,{target:{value:'prova12345678'}});
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid','false');
    fireEvent.click(screen.getByRole('button',{name:'Esporta'}));

    await waitFor(()=>expect(onSubmit).toHaveBeenCalledWith('prova12345678'));
  });
});
