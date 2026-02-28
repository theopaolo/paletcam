# API ColorCatcherServer

Base URL : `https://ccs.preview.name/api/v1`

Toutes les requetes et reponses sont en JSON.
Les erreurs de validation retournent un `422` avec le corps `{ "message": "...", "errors": { ... } }`.

---

## Authentification

Le flux est passwordless :

1. `POST /login` avec `email` pour recevoir un code OTP.
2. `POST /verify` (ou `GET /verify`) avec `email` + `code` pour obtenir un token.

Le token obtenu doit etre passe dans le header `Authorization: Bearer {token}` pour les routes protegees.

---

## Endpoints

### POST /login

Envoie un code OTP a 6 chiffres par email. Le code expire apres **10 minutes**.

**Body**

| Champ   | Type   | Requis | Description       |
|---------|--------|--------|-------------------|
| `email` | string | ✓      | Email utilisateur |

**Reponse `200`**

```json
{
  "message": "Code sent to your email."
}
```

### POST /verify

Verifie le code OTP et retourne un token.

**Body**

| Champ   | Type   | Requis | Description                |
|---------|--------|--------|----------------------------|
| `email` | string | ✓      | Email utilisateur          |
| `code`  | string | ✓      | Code OTP recu (6 chiffres) |

**Reponse `200`**

```json
{
  "token": "1|abc123...",
  "user": {
    "id": "01jnx4...",
    "name": "alexis",
    "email": "alexis@example.com"
  }
}
```

### GET /verify

Variante de verification (meme resultat attendu) avec `email` et `code` en query params.

---

### POST /publish

> **Authentification requise** — `Authorization: Bearer {token}`

Enregistre un nouveau catch (photo + couleurs dominantes).

**Body** — `application/json`

| Champ       | Type   | Requis | Description                                                        |
|-------------|--------|--------|--------------------------------------------------------------------|
| `photoBlob` | string | ✓      | Image WebP encodee en base64 (avec ou sans prefixe data URI)      |
| `timestamp` | string | ✓      | Date ISO 8601 de la capture (`2026-02-20T12:44:14.913Z`)          |
| `colors`    | array  | ✓      | Tableau de 4 objets `{r, g, b}`                                   |

```json
{
  "photoBlob": "UklGRg...base64...==",
  "timestamp": "2026-02-20T12:44:14.913Z",
  "colors": [
    {"r": 166, "g": 150, "b": 136},
    {"r": 207, "g": 198, "b": 186},
    {"r": 124, "g": 79,  "b": 57},
    {"r": 190, "g": 161, "b": 135}
  ]
}
```

**Reponse `201`**

```json
{
  "message": "Catch stored.",
  "catch": {
    "id": "01jnx4..."
  }
}
```

---

### POST /catches/statuses

> **Authentification requise** — `Authorization: Bearer {token}`

Retourne le statut de moderation pour une liste d'IDs distants.

**Body** — `application/json`

| Champ | Type          | Requis | Description                           |
|-------|---------------|--------|---------------------------------------|
| `ids` | array<string> | ✓      | Liste des `remoteCatchId` a verifier  |

```json
{
  "ids": ["01jnx4...", "01jny9..."]
}
```

**Statuts possibles**

- `TO_MODERATE`
- `VALID`
- `REJECTED`
