/**
 * Cambia la contraseña de un usuario de la app directamente en Supabase (sin email).
 * La contraseña se escribe en el terminal sin mostrarse; nunca se guarda en ficheros.
 * Uso: npm run user:password -- hola@volkra.es
 */
import fs from "node:fs";
import readline from "node:readline";
import { createDb } from "../src/server/db/client";

function ask(question: string, hidden: boolean): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
      out._writeToOutput = (s: string) => {
        if (s.startsWith(question)) out.output.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!email) throw new Error("Indica el email: npm run user:password -- hola@volkra.es");
  const url = process.env.DATABASE_URL ?? fs.readFileSync(".env.vercel", "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="))?.slice(13);
  if (!url) throw new Error("Falta DATABASE_URL");
  const p1 = await ask("Nueva contraseña (mín. 10 caracteres): ", true);
  if (p1.length < 10) throw new Error("Demasiado corta.");
  const p2 = await ask("Repítela: ", true);
  if (p1 !== p2) throw new Error("No coinciden.");
  const db = await createDb({ databaseUrl: url });
  try {
    const r = await db.query(
      `update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')),
              email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
        where email = $1 returning email`,
      [email, p1],
    );
    console.log(r.length ? `Contraseña cambiada para ${email}. Entra en https://entrada.volkra.es/login` : `No existe ningún usuario ${email}.`);
  } finally {
    await db.close();
  }
}
main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
