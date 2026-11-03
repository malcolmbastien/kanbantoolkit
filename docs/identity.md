# Identity: signing in, and being provisioned

**OIDC** says who a person is when they arrive. **SCIM** says who the team *is*: the identity
provider pushes arrivals and departures in, so nobody maintains the roster twice.

An instance without an IdP is complete. People sign in with a password or a magic link, and an
administrator invites them; SCIM is for a team that already runs a directory.

## Signing in (OIDC)

One provider, configured by environment — `docs/configure.md` has every value:

| | |
| --- | --- |
| `AUTH_OIDC_CLIENT_ID`, `AUTH_OIDC_CLIENT_SECRET` | the client registered with the issuer |
| `AUTH_OIDC_AUTHORIZE_ENDPOINT`, `AUTH_OIDC_TOKEN_ENDPOINT`, `AUTH_OIDC_USERINFO_ENDPOINT` | the issuer's three endpoints, used exactly as given. The server does not look them up. |
| `AUTH_OIDC_LABEL` | the text on the sign-in button |

The redirect URI to register is `https://<your instance>/api/auth/callback`. Kanban Toolkit asks for
`openid email profile`, and it refuses an identity whose address the provider has not verified.

A password and a magic link sit beside the provider: a deployment with no provider, and a person whose
provider is down, are not locked out. Neither method is required.

## Provisioning (SCIM 2.0)

The base URL is:

```
https://<your instance>/scim/v2
```

### The token

**Admin → Directory provisioning → Make a token.** Name it after the provider, choose the
**workspace role** a provisioned person gets, and copy the secret into the provider's "provisioning"
screen. It is shown once; the server keeps a hash. Revoke it in the same panel, and the provider is
refused on its next call.

| | |
| --- | --- |
| Header | `Authorization: Bearer *** |
| Scope | provisioning only: it can create people and group membership. It cannot read a board, and it cannot administer the instance. |
| The role it carries | **workspace** only — viewer, editor (the default) or workspace administrator. A directory cannot make somebody the administrator of the deployment. |
| Rate limit | `API_RATE_LIMIT` a minute (120 by default), per token |
| Minting, for a script | `GET`/`POST /api/admin/scim/tokens` and `DELETE /api/admin/scim/tokens/:id` — instance-administrator routes, the same ones the panel calls |

A SCIM token belongs to the directory. Every change it makes is in the audit trail under
`scim.user.create`, `scim.user.update`, `scim.user.delete`, `scim.group.*` and `scim.token.*`, with
the token named and never its value.

### Endpoints

| Route | What it does |
| --- | --- |
| `GET /ServiceProviderConfig` | patch and filter, no bulk, no sorting |
| `GET /ResourceTypes`, `GET /Schemas` | what a strict client validates before connecting |
| `GET /Users?filter=userName eq "…"` | one page of people; also `externalId eq "…"`, `displayName eq "…"`, `active eq true` |
| `POST /Users` | create an account and seat it with the token's role |
| `GET /Users/{id}` | one person |
| `PUT /Users/{id}` | replace their address, name, `externalId` and `active` |
| `PATCH /Users/{id}` | the same fields, in the RFC's `Operations` shape |
| `DELETE /Users/{id}` | remove the account — the irreversible act |
| `GET /Groups`, `POST /Groups` | the groups this server has, and new ones |
| `GET /Groups/{id}`, `PUT /Groups/{id}` | one group, replaced whole |
| `PATCH /Groups/{id}` | add or remove members |
| `DELETE /Groups/{id}` | delete the group |

`startIndex` and `count` page a list; `totalResults` is the whole count, not the page.

### What each operation does to a person

| SCIM | Kanban Toolkit |
| --- | --- |
| `POST /Users` | an account (`users`), an instance membership, and a **workspace seat** carrying the token's role. No password: the directory is the door. |
| `PATCH {"active": false}` | **deactivation** — the account stays, the name stays on the work, and their sessions end. Reversible with `active: true`. |
| `PUT /Users/{id}` with `active: false` | the same act. |
| `DELETE /Users/{id}` | the account is removed, the way the app removes one: sessions, group memberships and seats go with it, the **work stays** and every card that named them reads *Former member*. |

A provisioning system that deletes by default must not be able to erase a team's history by accident:
`active` is the operation to reach for, `DELETE` the one that means it.

### Duplicates

Creating a person whose address already exists is a **`409`**, not a second account and not a silent
merge. The detail names the existing id; the recovery is `GET /Users?filter=userName eq "…"` and
continue with that resource. `externalId` is unique too, and a collision is a `409`.

`DELETE` is the RFC's answer: `204` the first time, `404` after — a sync that retries a removal gets
an answer it can live with rather than an error to escalate.

### Groups, and the boundary

SCIM creates groups and changes their membership, because that is what a directory knows. **A group
carries authority only when an administrator granted it a role in the app** — the group's own people,
its "Role in this workspace" select. Adding somebody to a group through SCIM does not change their
seat, and a SCIM request cannot set a role: there is no field for one.

### The account that arrives with no password

A provisioned person has no password: the directory is the door. Tell them how to sign in:

- if the deployment has a mail relay, they can ask for a **magic link** on the sign-in screen;
- if it does not, an administrator can hand them an **invitation link**, which is also where they set
  a password if they want one;
- if the deployment uses an OIDC provider, they sign in through it — SCIM put the account there and
  OIDC is how they reach it.

Their account screen is the ordinary one: name, picture and sessions, saying the account was
provisioned by the directory rather than offering a password field it cannot fill.

### Errors

Every refusal is SCIM's own shape, with the HTTP status matching `status`:

```json
{ "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"], "detail": "userName already exists; GET /Users?filter=userName eq \"ada@example.com\" for id u_…", "status": "409" }
```

A revoked or unknown token is `401`; an unsupported filter is `400`; a missing resource is `404`; a
spent rate limit is `429` with `Retry-After`.

### What SCIM does not do

- It cannot make an instance administrator, or change an instance role.
- It cannot set a workspace role, directly or through a group.
- It cannot read the board, or anything that is not provisioning.
- It does not replace invitations: an instance with no directory still invites people by link.
