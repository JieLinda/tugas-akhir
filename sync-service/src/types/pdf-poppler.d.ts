declare module "pdf-poppler" {
  interface ConvertOptions {
    format: "png" | "jpeg";
    out_dir: string;
    out_prefix: string;
    page?: number | null;
  }

  const pdfPoppler: {
    convert(input: string, opts: ConvertOptions): Promise<void>;
  };

  export default pdfPoppler;
}
