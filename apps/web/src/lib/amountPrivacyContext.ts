import { createContext,useContext } from 'react';

export type AppSettings={theme:'light'|'dark'|'system';hideAmounts:boolean;quickAmountsCents:string[]};
export type SettingsResponse={settings:AppSettings};
type AmountPrivacy={hidden:boolean;toggle:()=>void;isUpdating:boolean;theme:AppSettings['theme'];setTheme:(theme:AppSettings['theme'])=>void};

export const fallbackSettings:AppSettings={theme:'system',hideAmounts:false,quickAmountsCents:['5000','10000','15000','25000','45000']};
export const AmountPrivacyContext=createContext<AmountPrivacy>({hidden:false,toggle:()=>undefined,isUpdating:false,theme:'system',setTheme:()=>undefined});

export function useAmountPrivacy(){return useContext(AmountPrivacyContext)}
