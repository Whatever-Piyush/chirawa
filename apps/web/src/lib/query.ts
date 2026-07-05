import { QueryClient } from '@tanstack/react-query';

// Factory for a TanStack Query client. On the client we keep one instance per
// browser tab (see Providers); on the server a fresh client is made per request.
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000, // 1 min — catalog data changes slowly
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}
