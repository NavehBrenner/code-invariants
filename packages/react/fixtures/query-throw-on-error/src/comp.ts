import { useQuery } from "@tanstack/react-query";

export function Comp() {
  const q = useQuery({ queryKey: ["x"], queryFn: () => 1, throwOnError: true });
  return q.data;
}
