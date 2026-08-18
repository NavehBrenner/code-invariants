import { useQuery } from "@tanstack/react-query";

export function Comp() {
  const { data, isError } = useQuery({ queryKey: ["x"], queryFn: () => 1 });
  if (isError) {
    return null;
  }
  return data;
}
