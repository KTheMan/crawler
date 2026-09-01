import { preview } from "vite";

const port = 4186;

export default async function startSolidFeatureQualificationServer() {
  const server = await preview({
    preview: {
      host: "127.0.0.1",
      port,
      strictPort: true,
    },
  });

  return async () => {
    await server.close();
  };
}
