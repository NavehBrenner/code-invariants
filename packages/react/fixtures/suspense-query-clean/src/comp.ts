import { useSuspenseQuery } from "@tanstack/react-query";

export function Comp() {
  const q = useSuspenseQuery({ queryKey: ["x"], queryFn: () => 1 });
  return q.data;
}
