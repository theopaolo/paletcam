
 ________  ________  ___       ________  ________                          
|\   ____\|\   __  \|\  \     |\   __  \|\   __  \                         
\ \  \___|\ \  \|\  \ \  \    \ \  \|\  \ \  \|\  \                        
 \ \  \    \ \  \\\  \ \  \    \ \  \\\  \ \   _  _\                       
  \ \  \____\ \  \\\  \ \  \____\ \  \\\  \ \  \\  \|                      
   \ \_______\ \_______\ \_______\ \_______\ \__\\ _\                      
    \|_______|\|_______|\|_______|\|_______|\|__|\|__|                     
                                                                           
                                                                           
                                                                           
 ________  ________  _________  ________  ___  ___  _______   ________     
|\   ____\|\   __  \|\___   ___\\   ____\|\  \|\  \|\  ___ \ |\   __  \    
\ \  \___|\ \  \|\  \|___ \  \_\ \  \___|\ \  \\\  \ \   __/|\ \  \|\  \   
 \ \  \    \ \   __  \   \ \  \ \ \  \    \ \   __  \ \  \_|/_\ \   _  _\  
  \ \  \____\ \  \ \  \   \ \  \ \ \  \____\ \  \ \  \ \  \_|\ \ \  \\  \| 
   \ \_______\ \__\ \__\   \ \__\ \ \_______\ \__\ \__\ \_______\ \__\\ _\ 
    \|_______|\|__|\|__|    \|__|  \|_______|\|__|\|__|\|_______|\|__|\|__|
                                                                           
                                                                           
                                                                           
 ________  _______   ________  ___      ___ _______   ________             
|\   ____\|\  ___ \ |\   __  \|\  \    /  /|\  ___ \ |\   __  \            
\ \  \___|\ \   __/|\ \  \|\  \ \  \  /  / | \   __/|\ \  \|\  \           
 \ \_____  \ \  \_|/_\ \   _  _\ \  \/  / / \ \  \_|/_\ \   _  _\          
  \|____|\  \ \  \_|\ \ \  \\  \\ \    / /   \ \  \_|\ \ \  \\  \|         
    ____\_\  \ \_______\ \__\\ _\\ \__/ /     \ \_______\ \__\\ _\         
   |\_________\|_______|\|__|\|__|\|__|/       \|_______|\|__|\|__|        
   \|_________|                                                            
                                                                           
                                                                           


 ________  ________  ___       ________  ________                          
|\   ____\|\   __  \|\  \     |\   __  \|\   __  \                         
\ \  \___|\ \  \|\  \ \  \    \ \  \|\  \ \  \|\  \                        
 \ \  \    \ \  \\\  \ \  \    \ \  \\\  \ \   _  _\                       
  \ \  \____\ \  \\\  \ \  \____\ \  \\\  \ \  \\  \|                      
   \ \_______\ \_______\ \_______\ \_______\ \__\\ _\                      
    \|_______|\|_______|\|_______|\|_______|\|__|\|__|                     
                                                                           
                                                                           
                                                                           
 ________  ________  _________  ________  ___  ___  _______   ________     
|\   ____\|\   __  \|\___   ___\\   ____\|\  \|\  \|\  ___ \ |\   __  \    
\ \  \___|\ \  \|\  \|___ \  \_\ \  \___|\ \  \\\  \ \   __/|\ \  \|\  \   
 \ \  \    \ \   __  \   \ \  \ \ \  \    \ \   __  \ \  \_|/_\ \   _  _\  
  \ \  \____\ \  \ \  \   \ \  \ \ \  \____\ \  \ \  \ \  \_|\ \ \  \\  \| 
   \ \_______\ \__\ \__\   \ \__\ \ \_______\ \__\ \__\ \_______\ \__\\ _\ 
    \|_______|\|__|\|__|    \|__|  \|_______|\|__|\|__|\|_______|\|__|\|__|
                                                                           
                                                                           
                                                                           
 ________  _______   ________  ___      ___ _______   ________             
|\   ____\|\  ___ \ |\   __  \|\  \    /  /|\  ___ \ |\   __  \            
\ \  \___|\ \   __/|\ \  \|\  \ \  \  /  / | \   __/|\ \  \|\  \           
 \ \_____  \ \  \_|/_\ \   _  _\ \  \/  / / \ \  \_|/_\ \   _  _\          
  \|____|\  \ \  \_|\ \ \  \\  \\ \    / /   \ \  \_|\ \ \  \\  \|         
    ____\_\  \ \_______\ \__\\ _\\ \__/ /     \ \_______\ \__\\ _\         
   |\_________\|_______|\|__|\|__|\|__|/       \|_______|\|__|\|__|        
   \|_________|                                                            
                                                                           
                                                                           

# API ColorCatcherServer

Base URL : `http://ccs.test/api/v1`

Toutes les requêtes et réponses sont en JSON.
Les erreurs de validation retournent un `422` avec le corps `{ "message": "...", "errors": { ... } }`.

---

## Authentification

Le flux est passwordless :

```
POST /register  →  créer un compte
POST /login     →  recevoir un code OTP par email
POST /verify    →  échanger le code contre un token Sanctum
```

Le token obtenu doit être passé dans le header `Authorization: Bearer {token}` pour les routes protégées.

---

## Endpoints

### POST /register

Crée un compte à partir d'un email.

**Body**

| Champ   | Type   | Requis | Description          |
|---------|--------|--------|----------------------|
| `email` | string | ✓      | Email unique         |

**Réponse `201`**

```json
{
  "message": "Account created.",
  "user": {
    "id": "01jnx4...",
    "name": "alexis",
    "email": "alexis@example.com"
  }
}
```

> Le `name` est dérivé automatiquement de la partie locale de l'email (`alexis@` → `alexis`). En cas de doublon, un suffixe numérique est ajouté (`alexis42`).

**Erreurs**

| Code  | Cause                  |
|-------|------------------------|
| `422` | Email invalide ou déjà utilisé |

---

### POST /login

Envoie un code OTP à 6 chiffres par email. Le code expire après **10 minutes**.

**Body**

| Champ   | Type   | Requis | Description                    |
|---------|--------|--------|--------------------------------|
| `email` | string | ✓      | Email d'un compte existant     |

**Réponse `200`**

```json
{
  "message": "Code sent to your email."
}
```

**Erreurs**

| Code  | Cause                   |
|-------|-------------------------|
| `422` | Email inconnu           |

---

### POST /verify

Vérifie le code OTP et retourne un token Sanctum.

**Body**

| Champ   | Type   | Requis | Description              |
|---------|--------|--------|--------------------------|
| `email` | string | ✓      | Email du compte          |
| `code`  | string | ✓      | Code OTP reçu (6 chiffres) |

**Réponse `200`**

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

**Erreurs**

| Code  | Cause                                          |
|-------|------------------------------------------------|
| `422` | Code incorrect, expiré, ou aucun code en attente |

---

### POST /catch/publish

> **Authentification requise** — `Authorization: Bearer {token}`

Enregistre un nouveau catch (photo + couleurs dominantes).

> Les catches des utilisateurs admin sont publiés directement avec le statut `valid`. Les autres passent en `to_moderate`.

**Body** — `application/json`

| Champ                | Type   | Requis | Description                                              |
|----------------------|--------|--------|----------------------------------------------------------|
| `photoBlob`          | string | ✓      | Image WebP encodée en base64 (avec ou sans préfixe data URI) |
| `timestamp`          | string | ✓      | Date ISO 8601 de la capture (`2026-02-20T12:44:14.913Z`) |
| `colors`             | array  | ✓      | Tableau de 4 objets `{r, g, b}`                          |
| `captureAspectRatio` | string |        | Ratio d'aspect de la capture (ex: `"4/3"`, `"16/9"`)    |
| `captureCropRect`    | object |        | Zone de crop dans l'image originale, ou `null`           |
| `captureCropRect.x`  | number | ✓*     | Origine X du crop (pixels)                               |
| `captureCropRect.y`  | number | ✓*     | Origine Y du crop (pixels)                               |
| `captureCropRect.width`  | number | ✓* | Largeur du crop (pixels)                                |
| `captureCropRect.height` | number | ✓* | Hauteur du crop (pixels)                               |

> \* Requis si `captureCropRect` est fourni (non null).
> Le préfixe `data:image/webp;base64,` est accepté mais optionnel.

```json
{
  "photoBlob": "UklGRg...base64...==",
  "timestamp": "2026-02-20T12:44:14.913Z",
  "colors": [
    {"r": 166, "g": 150, "b": 136},
    {"r": 207, "g": 198, "b": 186},
    {"r": 124, "g": 79,  "b": 57},
    {"r": 190, "g": 161, "b": 135}
  ],
  "captureAspectRatio": "4/3",
  "captureCropRect": { "x": 0, "y": 0, "width": 1280, "height": 960 }
}
```

**Réponse `201`**

```json
{
  "message": "Catch stored.",
  "catch": {
    "id": "01jnx4..."
  }
}
```

**Erreurs**

| Code  | Cause                                               |
|-------|-----------------------------------------------------|
| `401` | Token manquant ou invalide                          |
| `422` | Photo non-WebP, `colors` invalides, timestamp absent, `captureCropRect` incomplet |

---

### POST /catches/statuses

> **Authentification requise** — `Authorization: Bearer {token}`

Retourne le statut de modération pour une liste d'IDs de catches appartenant à l'utilisateur authentifié. Les IDs inconnus ou appartenant à un autre utilisateur sont silencieusement ignorés.

**Body**

| Champ  | Type            | Requis | Description                  |
|--------|-----------------|--------|------------------------------|
| `ids`  | array\<string\> | ✓      | Liste d'IDs de catches (ULID) |

```json
{
  "ids": ["01jnx4...", "01jnx5...", "01jnx6..."]
}
```

**Réponse `200`**

```json
{
  "catches": [
    { "id": "01jnx4...", "status": "to_moderate" },
    { "id": "01jnx5...", "status": "valid" }
  ],
  "deletedIds": ["01jnx6..."],
  "notFoundIds": ["01jnx7..."]
}
```

| Champ        | Description                                                      |
|--------------|------------------------------------------------------------------|
| `catches`    | Catches trouvés avec leur statut                                 |
| `deletedIds` | IDs des catches supprimés (soft-deleted) appartenant à l'utilisateur |
| `notFoundIds`| IDs inconnus ou appartenant à un autre utilisateur               |

Valeurs possibles de `status` : `to_moderate`, `valid`, `rejected`.

**Erreurs**

| Code  | Cause                      |
|-------|----------------------------|
| `401` | Token manquant ou invalide |
| `422` | `ids` absent ou invalide   |

---

### DELETE /catch/{id}

> **Authentification requise** — `Authorization: Bearer {token}`

Supprime un catch appartenant à l'utilisateur authentifié.

**Réponse `200`**

```json
{ "message": "Catch deleted." }
```

**Erreurs**

| Code  | Cause                                      |
|-------|--------------------------------------------|
| `401` | Token manquant ou invalide                 |
| `403` | Le catch appartient à un autre utilisateur |
| `404` | ID inconnu                                 |

---

### POST /catch/{id}/unpublish

> **Authentification requise** — `Authorization: Bearer {token}`

Passe un catch au statut `private`, le retirant de la grille publique sans le supprimer.

**Réponse `200`**

```json
{ "message": "Catch unpublished." }
```

**Erreurs**

| Code  | Cause                                      |
|-------|--------------------------------------------|
| `401` | Token manquant ou invalide                 |
| `403` | Le catch appartient à un autre utilisateur |
| `404` | ID inconnu                                 |
