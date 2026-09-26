import { createClient } from "npm:@supabase/supabase-js@2.117.1";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.0";

const REPOSITORY = "sysandro02-byte/Mbot-Room";
const REF = "refs/heads/main";
const AUDIENCE = "mboteroom-supabase-storage";
const WORKFLOW_FRAGMENT = "/.github/workflows/android-apk.yml@refs/heads/main";
const BUCKET = "mboteroom-releases";
const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

const readSecretKey = () => {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    if (typeof keys?.default === "string" && keys.default) return keys.default;
  } catch {
    // Fallback below.
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
};

const asString = (value: unknown) => String(value || "");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);

  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return json({ error: "Jeton GitHub Actions OIDC requis." }, 401);
  }

  try {
    const token = authorization.slice("Bearer ".length).trim();
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    const repository = asString(payload.repository);
    const ref = asString(payload.ref);
    const workflowRef = asString(payload.workflow_ref);
    const eventName = asString(payload.event_name);
    const sha = asString(payload.sha).toLowerCase();

    if (repository !== REPOSITORY || ref !== REF) {
      return json({ error: "Dépôt ou branche GitHub non autorisé." }, 403);
    }
    if (!workflowRef.includes(WORKFLOW_FRAGMENT)) {
      return json({ error: "Workflow GitHub non autorisé." }, 403);
    }
    if (!["push", "workflow_dispatch"].includes(eventName)) {
      return json({ error: "Événement GitHub non autorisé." }, 403);
    }
    if (!/^[a-f0-9]{40}$/.test(sha)) {
      return json({ error: "SHA GitHub invalide." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const secretKey = readSecretKey();
    if (!supabaseUrl || !secretKey) {
      return json({ error: "Supabase Storage n’est pas configuré côté serveur." }, 503);
    }

    const client = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const base = `android/builds/${sha}`;
    const paths = {
      apk: `${base}/MBoteRoom-Android.apk`,
      aab: `${base}/MBoteRoom-Android.aab`,
      checksum: `${base}/MBoteRoom-Android.sha256`,
      manifest: "android/latest.json",
    };

    const issue = async (path: string, upsert: boolean) => {
      const { data, error } = await client.storage.from(BUCKET).createSignedUploadUrl(path, { upsert });
      if (error || !data?.signedUrl || !data?.token) {
        throw new Error(error?.message || `Impossible de préparer l’upload pour ${path}`);
      }
      return { path, signedUrl: data.signedUrl, token: data.token };
    };

    const [apk, aab, checksum, manifest] = await Promise.all([
      issue(paths.apk, true),
      issue(paths.aab, true),
      issue(paths.checksum, true),
      issue(paths.manifest, true),
    ]);

    const publicBase = `${supabaseUrl}/storage/v1/object/public/${BUCKET}`;

    return json({
      bucket: BUCKET,
      sha,
      expiresInSeconds: 7200,
      uploads: { apk, aab, checksum, manifest },
      public: {
        apkUrl: `${publicBase}/${paths.apk}`,
        aabUrl: `${publicBase}/${paths.aab}`,
        checksumUrl: `${publicBase}/${paths.checksum}`,
        manifestUrl: `${publicBase}/${paths.manifest}`,
      },
    });
  } catch (error) {
    console.error("[mboteroom-android-publish]", error);
    return json({ error: "Authentification ou préparation de publication refusée." }, 401);
  }
});
