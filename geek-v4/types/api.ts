export type PaginatedResponse<T> = {
  data: T[];
  nextCursor: string | null;
};
