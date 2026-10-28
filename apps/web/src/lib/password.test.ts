import { describe,expect,it } from 'vitest';
import { generatePassword,passwordStrength } from './password';

describe('generatePassword',()=>{
  it('builds dash-separated groups without ambiguous characters',()=>{
    for(let attempt=0;attempt<50;attempt++){
      const password=generatePassword();
      expect(password).toMatch(/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);
      expect(password).not.toMatch(/[0O1lI]/);
    }
  });

  it('does not repeat itself',()=>{
    expect(new Set(Array.from({length:20},()=>generatePassword())).size).toBe(20);
  });
});

describe('passwordStrength',()=>{
  it('rates short passwords as too short and rewards length and variety',()=>{
    expect(passwordStrength('corta').score).toBe(0);
    expect(passwordStrength('abcdefghijkl').score).toBe(1);
    expect(passwordStrength('Abcdefghijk1').score).toBe(2);
    expect(passwordStrength('Abcdefghijk1-mnopq').score).toBe(4);
  });
});
