import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';

/**
 * Deux projets, un seul fichier de config.
 *
 *   unit — tests hermetiques. Aucun service externe, aucune variable
 *          d'environnement requise. C'est le seul projet destine a servir
 *          de gate : il doit sortir en code 0 depuis un clone propre sans
 *          `.env`, ET sur une machine qui possede un `.env.local`.
 *
 *   rls  — tests d'integration Row Level Security. Ils creent de vrais
 *          workspaces contre une instance Supabase live et exigent
 *          NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY /
 *          NEXT_PUBLIC_SUPABASE_ANON_KEY (cf. __tests__/rls/setup.ts).
 *          Ils ne peuvent donc pas etre un gate de PR.
 *
 * Pourquoi `projects` plutot que deux fichiers de config : l'alias `@` est
 * defini UNE fois et partage, et `vitest list --run --filesOnly` prouve en
 * une commande qu'aucun fichier de test n'est perdu entre les deux projets
 * (chaque ligne est prefixee [unit] ou [rls]).
 *
 * `vitest run` nu execute les DEUX projets — il reste donc rouge sans base,
 * exactement comme avant ce changement. Le gate est `test:unit`.
 */

const alias = { '@': path.resolve(__dirname, '.') };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          exclude: [...configDefaults.exclude, '__tests__/rls/**'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'rls',
          environment: 'node',
          include: ['__tests__/rls/**/*.test.ts'],
        },
      },
    ],
  },
});
