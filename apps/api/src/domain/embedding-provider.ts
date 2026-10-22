export interface EmbeddingProvider {
  readonly identity: string;
  embed(input: string[]): Promise<number[][]>;
}
