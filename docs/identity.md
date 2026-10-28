# Identity: signing in, and being provisioned

Two halves, and they are different jobs. **OIDC** says who a person is when they arrive.
**SCIM** says who the team *is* — the identity provider pushes arrivals and departures in, so nobody
maintains the roster twice.

An instance without an IdP is still a complete product: people sign in with a password or a magic
link, and an administrator invites them. SCIM is for a team that already runs a directory.

## Signing in (OIDC)

One provider, configured by environment — `docs/configure.md` has every value:

| | |
| --- | --- |
| `AUTH_OIDC_ISSUER` | the issuer's URL; its discovery document supplies the endpoints when they are not set |
| `AUTH_OIDC_CLIENT_ID`, `AUTH_OIDC_CLIENT_SECRET` | the client registered with that issuer |
| `AUTH_OIDC_LABEL` | what the sign-in button says |

The redirect URI to register is `https://<your instance>/api/auth/callback`. Kanban Toolkit asks for
`openid email profile` and nothing more, and it refuses an identity whose address the provider has not
verified.

A password door and a magic-link door sit beside it (task 154), so a deployment with no IdP — or a
person whose provider is down — is not locked out. Neither is required.

## Provisioning (SCIM 2.0)

The base URL is:

```
https://<your instance>/scim/v2
```

### The token

**Admin → Directory provisioning → Make a token.** Name it after the provider (so two can be told
apart), choose the **workspace role** a provisioned person gets, and copy the secret into the
provider's "provisioning" screen. It is shown once; the server keeps a hash. Revoke it in the same
panel, and the provider is refused on its next call.

| | |
| --- | --- |
| Header | `Authorization: Bearer fls_…` |
| Scope | provisioning only: it can create people and group membership. It cannot read a board, and it cannot administer the instance. |
| The role it carries | **workspace** only — viewer, editor (the default) or workspace administrator. A directory may make somebody an editor of this team; it may not make them the administrator of the deployment. |
| Rate limit | `API_RATE_LIMIT` a minute (120 by default), per token |
| Minting, for a script | `GET`/`POST /api/admin/scim/tokens` and `DELETE /api/admin/scim/tokens/:id` — instance-administrator routes, the same ones the panel calls |

A SCIM token is not a person's credential: it belongs to the directory. Every change it makes is in
the audit trail under `scim.user.create`, `scim.user.update`, `scim.user.delete`, `scim.group.*` and
`scim.token.*`, with the token named and never its value.

### Endpoints

| Route | What it does |
| --- | --- |
| `GET /ServiceProviderConfig` | what this server supports: patch and filter, no bulk, no sorting |
| `GET /ResourceTypes`, `GET /Schemas` | the resources and schemas a strict client validates before it connects |
| `GET /Users?filter=userName eq "…"` | one page of people; also `externalId eq "…"`, `displayName eq "…"`, `active eq true` |
| `POST /Users` | create an account and seat it with the token's role |
| `GET /Users/{id}` | one person |
| `PUT /Users/{id}` | replace their address, name, `externalId` and `active` |
| `PATCH /Users/{id}` | the same fields, in the RFC's `Operations` shape |
| `DELETE /Users/{id}` | remove the account — the irreversible act |
| `GET /Groups`, `POST /Groups` | the groups this server already has, and new ones |
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

That asymmetry is deliberate. A provisioning system that deletes by default must not be able to erase
a team's history by accident, so `active` is the operation to reach for and `DELETE` is the one that
means it.

### Duplicates

Creating a person whose address already exists is a **`409`**, not a second account, and not a silent
merge. The detail names the id that already exists, and the standard recovery is the one a client
already knows: `GET /Users?filter=userName eq "…"` and continue with that resource. The same is true
of `externalId`: it is unique, and a collision is a `409`.

`DELETE` is the RFC's answer: `204` the first time, `404` after — a sync that retries a removal gets
an answer it can live with rather than an error to escalate.

### Groups, and the boundary

SCIM creates groups and changes their membership, because that is what a directory knows. **A group
carries authority only when an administrator granted it a role in the app** — the group's own people,
its "Role in this workspace" select. Adding somebody to a group through SCIM does not change their
seat, and a SCIM request cannot set a role: there is no field for one. The line is: *the provider
provisions people and membership; the team decides authority.*

### The account that arrives with no password

A provisioned person has an account and no way to sign in by password — the directory is the door.
That is normal and intended, and it is worth saying to the team:

- if the deployment has a mail relay, they can ask for a **magic link** on the sign-in screen;
- if it does not, an administrator can hand them an **invitation link**, which is also where they set
  a password if they want one;
- if the deployment uses an OIDC provider, they simply sign in through it — SCIM put the account
  there and OIDC is how they reach it.

Their account screen is the ordinary one: name, picture, language, sessions. It says the account was
provisioned by the directory rather than offering a password field it cannot fill.

### Errors

Every refusal is SCIM's own shape, with the HTTP status matching `status`, because a client that
cannot parse a failure retries forever:

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
