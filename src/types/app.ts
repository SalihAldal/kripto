export type AppEnv = "development" | "test" | "production";

export type AsyncState<T> = {
  loading: boolean;
  data: T | null;
  error: string | null;
};
