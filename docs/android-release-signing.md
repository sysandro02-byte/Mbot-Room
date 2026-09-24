# Signature Android MBotéRoom

La version Android officielle de MBotéRoom est signée avec une clé permanente.

## Secrets GitHub requis

Dans `Settings > Secrets and variables > Actions > Repository secrets`, créer :

- `MBOTEROOM_ANDROID_KEYSTORE_BASE64`
- `MBOTEROOM_ANDROID_KEYSTORE_PASSWORD`
- `MBOTEROOM_ANDROID_KEY_ALIAS`
- `MBOTEROOM_ANDROID_KEY_PASSWORD`

Le workflow `.github/workflows/android-apk.yml` refuse de publier un APK Release si l'un de ces secrets est absent.

## Clé

Le fichier privé attendu est `mboteroom-release.jks`.
L'alias recommandé est `mboteroom-release`.

Exemple de création locale :

```bash
keytool -genkeypair -v \
  -keystore mboteroom-release.jks \
  -storetype JKS \
  -alias mboteroom-release \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000
```

Ne jamais committer le fichier `.jks`, son contenu Base64 ou les mots de passe.

## Base64

Windows PowerShell :

```powershell
[Convert]::ToBase64String(
  [IO.File]::ReadAllBytes("mboteroom-release.jks")
) | Set-Clipboard
```

Linux :

```bash
base64 -w 0 mboteroom-release.jks
```

macOS :

```bash
base64 < mboteroom-release.jks | tr -d '\n'
```

## Sauvegarde

Conserver la même clé pour toutes les futures mises à jour Android. Garder au moins deux copies privées et sécurisées.
