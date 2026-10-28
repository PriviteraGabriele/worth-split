import { useCallback,useEffect } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { applyTheme } from './theme';
import { AmountPrivacyContext,fallbackSettings,type AppSettings,type SettingsResponse } from './amountPrivacyContext';
import { BrandMark } from '../components/BrandMark';

export function AmountPrivacyProvider({children}:{children:React.ReactNode}){
  const queryClient=useQueryClient();
  const settingsQuery=useQuery({queryKey:['settings'],queryFn:({signal})=>api<SettingsResponse>('/settings',{signal})});
  const update=useMutation({
    mutationFn:(settings:AppSettings)=>api<SettingsResponse>('/settings',{method:'PUT',body:JSON.stringify(settings)}),
    onMutate:next=>{
      const previous=queryClient.getQueryData<SettingsResponse>(['settings']);
      queryClient.setQueryData<SettingsResponse>(['settings'],{settings:next});
      return {previous};
    },
    onError:(_error,_settings,context)=>queryClient.setQueryData(['settings'],context?.previous),
    onSuccess:result=>queryClient.setQueryData(['settings'],result),
  });
  const settings=settingsQuery.data?.settings??fallbackSettings;
  const loaded=Boolean(settingsQuery.data);
  useEffect(()=>{if(loaded)applyTheme(settings.theme)},[loaded,settings.theme]);
  const toggle=useCallback(()=>{
    if(update.isPending)return;
    update.mutate({...settings,hideAmounts:!settings.hideAmounts});
  },[settings,update]);
  const setTheme=useCallback((theme:AppSettings['theme'])=>{
    if(theme===settings.theme)return;
    update.mutate({...settings,theme});
  },[settings,update]);

  if(settingsQuery.isLoading)return <div className="splash"><BrandMark className="brand-mark" label="WorthSplit"/></div>;
  return <AmountPrivacyContext.Provider value={{hidden:settings.hideAmounts,toggle,isUpdating:update.isPending,theme:settings.theme,setTheme}}>{children}</AmountPrivacyContext.Provider>;
}
