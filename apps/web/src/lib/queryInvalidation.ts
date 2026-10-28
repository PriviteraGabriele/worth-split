import type { QueryClient } from '@tanstack/react-query';

/**
 * Refresh data derived from a financial operation without keeping the form
 * open while background requests complete. Prefix matching also invalidates
 * every cached history filter.
 */
export function refreshFinancialData(queryClient:QueryClient){
  void queryClient.invalidateQueries({queryKey:['dashboard']});
  void queryClient.invalidateQueries({queryKey:['operations']});
  void queryClient.invalidateQueries({queryKey:['trends']});
}

/** Remove the previous account's financial cache immediately after logout. */
export function resetSessionData(queryClient:QueryClient){
  queryClient.removeQueries({predicate:query=>query.queryKey[0]!=='me'});
  void queryClient.resetQueries({queryKey:['me']});
}
