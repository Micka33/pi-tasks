**Spécification Produit**

**Objectif**
Créer un plugin permettant à un ou plusieurs agents de gérer des listes de tâches persistantes, ordonnées et partageables. Un agent doit pouvoir créer une liste, y ajouter des tâches, réclamer la prochaine tâche à exécuter, puis mettre à jour son état.

**Concepts**
Une `task_list` est une liste de tâches avec un identifiant stable `list_id`.

Une liste n’appartient pas forcément à un agent. Plusieurs agents peuvent partager la même liste en utilisant le même `list_id`.

Un agent peut être :
- créateur d’une liste
- propriétaire optionnel d’une liste privée
- assigné à une tâche
- détenteur temporaire d’une tâche en cours

**Statuts De Tâche**

| Statut | Signification |
|---|---|
| `todo` | tâche prête à être exécutée |
| `in_progress` | tâche réclamée par un agent |
| `blocked` | tâche bloquée ou mise en pause, nécessite une intervention ou information |
| `done` | tâche terminée |
| `canceled` | tâche annulée ou devenue inutile |

**Champs `task_lists`**

| Champ | Description |
|---|---|
| `id` | identifiant unique de la liste |
| `name` | nom lisible de la liste |
| `scope_type` | contexte de la liste : `workspace`, `thread`, `agent`, `global`, `custom` |
| `scope_key` | identifiant du contexte : chemin workspace, thread id, agent id, etc. |
| `visibility` | `private` ou `shared` |
| `owner_agent_id` | agent propriétaire si liste privée ou explicitement possédée |
| `created_by_agent_id` | agent ayant créé la liste |
| `created_at` | date de création |
| `updated_at` | date de dernière modification |

**Champs `tasks`**

| Champ | Description |
|---|---|
| `id` | identifiant unique de la tâche |
| `list_id` | liste à laquelle appartient la tâche |
| `position` | ordre d’exécution dans la liste |
| `title` | titre court de la tâche |
| `description` | description détaillée optionnelle |
| `notes` | mémoire locale de travail pour l’agent : contexte important, choix en cours, blocages, hypothèses et prochaines étapes |
| `status` | statut courant de la tâche |
| `assigned_to_agent_id` | agent auquel la tâche est réservée, optionnel |
| `claimed_by_agent_id` | agent qui exécute actuellement la tâche |
| `claim_expires_at` | date d’expiration du claim |
| `outcome` | obligatoire lors de la fermeture en `done` ou `canceled` ; résumé final des choix/décisions, actions prises et résultat obtenu |
| `created_at` | date de création |
| `updated_at` | date de dernière modification |
| `started_at` | date de début d’exécution |
| `completed_at` | date de fin si `done` ou `canceled` |

**Outils MCP**

| Outil | Fonction |
|---|---|
| `task_list_create` | créer une nouvelle liste de tâches |
| `task_lists_find` | retrouver des listes existantes par scope, visibilité ou propriétaire |
| `task_list_get` | lire une liste et ses tâches dans l’ordre d’exécution |
| `task_list_delete` | soft-delete une liste et toutes ses tâches actives |
| `task_private_access_events_get` | lire les événements d’audit de bypass privé visibles pour l’agent courant |
| `task_create` | ajouter une tâche unique |
| `task_add_many` | ajouter plusieurs tâches en une fois |
| `task_claim_next` | réclamer atomiquement la prochaine tâche `todo` |
| `task_update` | modifier une tâche, ses notes, son outcome ou son statut |
| `task_reorder` | réordonner des tâches |
| `task_release_expired_claims` | libérer les claims expirés |
| `task_delete` | supprimer une tâche |

**Workflow Agent Standard**

1. L’agent cherche une liste existante avec `task_lists_find`.
2. Si aucune liste adaptée n’existe, il crée une liste avec `task_list_create`.
3. Il ajoute les tâches avec `task_create` ou `task_add_many`.
4. Il appelle `task_claim_next` avec son `agent_id`.
5. Il exécute la tâche retournée.
   - Pendant l’exécution, il peut appeler `task_update(notes = ...)` pour stocker la mémoire locale de la tâche : contexte important, choix en cours, blocages, hypothèses et prochaines étapes.
6. Il appelle `task_update` avec `status = done`, `blocked`, `todo` ou `canceled`.
   - Si `status = done` ou `canceled`, il doit fournir `outcome` avec les choix/décisions, les actions prises et le résultat obtenu.
   - Si `status = blocked`, le claim actif est libéré mais, par défaut, `assigned_to_agent_id` devient l’agent qui met la tâche en pause.
   - Pour libérer complètement une tâche mise en pause, l’agent passe explicitement `assigned_to_agent_id = null` dans le même appel `task_update`.
7. Il répète jusqu’à ce que `task_claim_next` retourne aucune tâche.

**Règles De Partage**

Même base de données + même `list_id` = même liste partagée.

Deux agents peuvent travailler sur la même liste.

Deux agents ne doivent pas exécuter la même tâche en même temps.

Une tâche assignée à un agent ne doit être réclamée que par cet agent.

Une tâche non assignée peut être réclamée par n’importe quel agent ayant accès à la liste.

Lorsqu’une tâche est mise en pause (`blocked`), elle reste assignée à l’agent qui l’a mise en pause sauf demande explicite de libération (`assigned_to_agent_id = null`) ou de transfert vers un autre agent.

**Interface TUI Pi**

Le plugin Pi affiche un widget encadré au-dessus de l’éditeur quand des listes visibles existent.

Commandes utiles :
- `/task-lists` affiche par défaut uniquement `name` et `id` pour retrouver facilement les identifiants de listes ;
- `/task-lists full` affiche les métadonnées JSON complètes ;
- `/tasks <list_id>` affiche une vue détaillée lisible d’une liste et de ses tâches : id, agent, dates, description, notes et outcome ;
- `/tasks <list_id>` propose l’autocomplétion des `list_id` visibles dans la TUI Pi ;
- `/tasks <list_id> full` affiche le JSON complet ;
- `/task-audit [list_id] [full]` affiche les événements d’audit de bypass privé visibles ; avec `list_id`, l’accès à cette liste est requis ou un bypass explicite est demandé ;
- `/task-list-delete <list_id>` soft-delete une liste et ses tâches actives, avec autocomplétion des `list_id` visibles ;
- `/task-widget` propose l’autocomplétion des actions `on`, `off`, `compact`, `full`, `refresh` ;

Règles d’affichage :
- les tâches de l’agent courant sont affichées en premier ;
- les compteurs de listes utilisent un format lisible : `todo N · run N · blocked N · done N` ;
- les tâches `blocked` sont présentées comme `paused` ;
- le nom de liste n’est pas répété sur les tâches déjà affichées dans leur groupe ;
- le cadre est dimensionné selon la ligne affichée la plus longue ;
- le widget ne dépasse pas la limite TUI de 10 lignes et affiche ses propres lignes `… masquée(s)` au lieu de laisser Pi tronquer brutalement.

**Règle Centrale**
`task_claim_next` est l’unique manière normale de prendre une tâche à exécuter. Un agent ne doit pas choisir manuellement une tâche depuis `task_list_get` puis la passer lui-même en `in_progress`, car cela peut créer des conflits entre agents.
