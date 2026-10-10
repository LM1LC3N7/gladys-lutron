# Brouillon : annonce sur le forum Gladys

À poster dans le sujet [10385](https://community.gladysassistant.com/t/10385)
une fois la version 0.1.0 publiée et vérifiée sur du vrai matériel. Pas une
page de la documentation du store.

---

**Intégration Lutron (Caséta, RA2 Select, RadioRA 3, HomeWorks QSX) : 100 %
locale, testeurs bienvenus**

Bonjour à tous,

Lutron Caséta revenait souvent dans ce sujet comme le grand manque de
Gladys côté Amérique du Nord : voici une intégration externe, disponible
dans le store.

**Tout en local.** Gladys parle directement au bridge sur le réseau (LEAP),
sans compte Lutron, sans cloud, sans Internet. L'association se fait depuis
l'écran de configuration : recherche du bridge sur le réseau (ou son IP),
puis appui sur le bouton au dos du bridge. Seul l'ajout des appareils au
bridge passe, une fois, par l'application Lutron.

**Ce que ça apporte**

- variateurs (avec durée de fondu), interrupteurs, modules, relais, stores,
  rideaux, stores à lames, ventilateurs, présence par pièce, scènes Lutron,
  Smart Away, piles faibles ;
- les **télécommandes Pico** comme boutons Gladys : clic, double clic, appui
  long et relâchement, directement dans le déclencheur « Changement d'état
  de l'appareil » (ce que Home Assistant ne fait pas nativement) ;
- RadioRA 3 et HomeWorks QSX : claviers avec leurs gravures et voyants,
  lumières à blanc réglable et couleur, déclencheur « scène de pièce
  activée », action « appuyer sur un bouton de clavier » ;
- un widget « Aperçu Lutron » (bridge, Smart Away, pièces occupées, piles,
  derniers appuis) et les déclencheurs « bridge hors ligne / de retour » ;
- une connexion robuste : ping chaque minute, reconnexion, relecture
  complète des états après chaque reconnexion et toutes les 15 minutes ;
- un bouton **Diagnostic** qui écrit dans les journaux une description
  anonymisée de l'installation, pour signaler un problème.

**Pourquoi pas la librairie `lutron-leap` évoquée plus haut ?** Elle est en
GPL-3.0 (incompatible avec la licence Apache de l'intégration) et ne vérifie
pas le certificat du bridge, entre autres. Le client LEAP est donc écrit
pour l'occasion, sans dépendance, à partir de pylutron-caseta (la librairie
de Home Assistant, Apache-2.0). Le détail est dans l'audit du dépôt.

**Testeurs recherchés**, surtout avec RadioRA 3 ou HomeWorks QSX (je n'ai
que du Caséta) : installez, essayez, et en cas de souci joignez l'export du
bouton Diagnostic.

Dépôt et documentation : https://github.com/LM1LC3N7/gladys-lutron
