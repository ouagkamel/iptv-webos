// src/services/ListOrder.js — V13 §5.3 : ordre d'affichage = ordre du serveur.
// Les tables IndexedDB sont lues triées par clé primaire (`importId:stream_id`,
// ordre LEXICOGRAPHIQUE) : « …:10 » passe avant « …:2 », et la catégorie est
// ignorée. Cet ordre-là ne doit jamais atteindre l'utilisateur (listes ET zap
// ↑/↓ du lecteur). Règle : tri par (rang de catégorie côté serveur, sortIdx
// = position d'arrivée dans le flux, puis clé pour départage déterministe).
// Fonction pure : les workers enrichissent chaque ligne de `sortIdx`, le
// PlaylistManager fournit le rang depuis `db.categories`.

// rows : lignes brutes ; catNames : noms de catégories dans l'ordre serveur.
// Retourne un NOUVEL ARRAY trié (jamais de mutation — l'appelant garde la
// main sur ses références).
export function orderRows(rows, catNames) {
  const out = (rows || []).slice();
  if (out.length < 2) return out;
  const rank = Object.create(null);
  const names = catNames || [];
  for (let i = 0; i < names.length; i++) {
    if (rank[names[i]] === undefined) rank[names[i]] = i;
  }
  const TAIL = names.length + 1; // groupes absents du serveur → fin de liste, entre eux par sortIdx
  out.sort(function (a, b) {
    const ga = String((a && a.groupName) || 'Autres');
    const gb = String((b && b.groupName) || 'Autres');
    const ra = rank[ga] === undefined ? TAIL : rank[ga];
    const rb = rank[gb] === undefined ? TAIL : rank[gb];
    if (ra !== rb) return ra - rb;
    const sa = (a && a.sortIdx) | 0;
    const sb = (b && b.sortIdx) | 0;
    if (sa !== sb) return sa - sb;
    const ia = String((a && a.id) || '');
    const ib = String((b && b.id) || '');
    return ia < ib ? -1 : (ia > ib ? 1 : 0);
  });
  return out;
}
