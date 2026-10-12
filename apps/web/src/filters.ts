import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useUrlFilters(resetPage = false) {
  const [params, setParams] = useSearchParams(); const pending = useRef(params);
  useEffect(() => { pending.current = params; }, [params]);
  const change = (name: string, value: string) => {
    // Consecutive input events may arrive before router navigation commits.
    const next = new URLSearchParams(pending.current);
    if (value) next.set(name, value); else next.delete(name);
    if (resetPage && name !== 'page') next.delete('page');
    pending.current = next; setParams(next, { replace: true });
  };
  const clear = (keep: string[] = []) => {
    const next = new URLSearchParams();
    keep.forEach(name => { const value = pending.current.get(name); if (value) next.set(name, value); });
    pending.current = next; setParams(next, { replace: true });
  };
  return [params, change, clear] as const;
}
