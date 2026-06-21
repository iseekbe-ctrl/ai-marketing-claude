# Battery ETA

Application web (PWA) qui estime l'heure à laquelle la batterie d'un téléphone atteindra 0%, basée sur la vitesse de décharge réelle observée pendant l'utilisation.

## Comment ça marche

1. **Android (Chrome/Edge/Opera)** : l'app utilise la [Battery Status API](https://developer.mozilla.org/en-US/docs/Web/API/Battery_Status_API) (`navigator.getBattery()`) pour lire automatiquement le niveau de batterie et l'état de charge.
2. **iPhone / Firefox / navigateurs sans support** : cette API n'est pas disponible (retirée pour des raisons de confidentialité). Un formulaire de saisie manuelle permet de noter son pourcentage de batterie de temps en temps.
3. À chaque nouvelle mesure (automatique ou manuelle), l'app calcule une **régression linéaire** sur l'historique récent (fenêtre glissante de 3h, dans la session de décharge en cours) pour obtenir une vitesse de décharge en %/min.
4. Le temps restant = niveau actuel ÷ vitesse de décharge. L'heure d'épuisement (0%) = heure actuelle + temps restant.
5. Dès que le téléphone est rebranché puis débranché, une nouvelle session de décharge démarre pour ne pas fausser le calcul avec les données d'avant la charge.

Toutes les données restent en local (`localStorage`) sur l'appareil — rien n'est envoyé à un serveur.

## Lancer en local

```bash
cd battery-estimator
python3 -m http.server 8080
```

Puis ouvre `http://localhost:8080` (ou l'IP de ta machine depuis ton téléphone sur le même réseau Wi-Fi).

## Installer sur l'écran d'accueil (mobile)

- **Android (Chrome)** : menu ⋮ → "Ajouter à l'écran d'accueil" / "Installer l'application".
- **iPhone (Safari)** : bouton Partager → "Sur l'écran d'accueil". (la saisie restera manuelle, l'API Battery n'existe pas sur iOS)

## Limites connues

- La Battery Status API est dépréciée du standard web et n'est plus implémentée par Safari ni Firefox — seuls les navigateurs Chromium (Chrome/Edge/Opera, surtout sur Android) y donnent accès.
- L'estimation s'améliore avec le nombre de mesures : au démarrage d'une nouvelle session de décharge, prévoir quelques minutes avant d'obtenir un résultat fiable.
- C'est une estimation statistique basée sur la tendance récente, pas une mesure exacte du système — l'usage réel (écran, jeux, GPS) peut changer rapidement la vitesse de décharge.

## Structure

```
battery-estimator/
├── index.html      # UI
├── style.css       # styles
├── app.js          # logique : lecture batterie, régression, rendu, chart canvas
├── manifest.json   # manifeste PWA
├── sw.js           # service worker (cache offline)
└── icons/icon.svg  # icône d'app
```
