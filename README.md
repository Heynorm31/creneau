# Créneau

Jeu de parking mobile/desktop réalisé en JavaScript et Canvas.

## Démarrage

```bash
npm install
npm run dev
```

La page s'ouvre ensuite sur http://localhost:4173.

## Construire pour production

```bash
npm run build
```

Les fichiers optimisés sont générés dans le dossier `dist/`.

## Objectif

- passer en R puis reculer dans la place
- braquer pour aligner la voiture dans l'espace
- enfoncer l'embrayage pour changer de vitesse
- éviter les contacts et terminer le stationnement proprement

## Déploiement GitHub Pages

1. construire le projet : `npm run build`
2. publier le contenu de `dist/` sur GitHub Pages ou via un workflow de déploiement
