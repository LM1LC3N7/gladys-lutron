# Lutron pour Gladys Assistant

Pilotez vos lumières, stores et ventilateurs Lutron depuis Gladys, et
utilisez vos télécommandes Pico dans les scènes Gladys. Tout fonctionne **sur
votre réseau local**, avec le protocole LEAP de Lutron : aucun compte Lutron,
aucun cloud, aucune connexion Internet nécessaire à l'intégration.

> **Version de développement.** L'intégration est construite étape par
> étape ; les sections ci-dessous décrivent l'objectif de la version 0.1.0.
> Ce qui fonctionne déjà est listé dans le
> [journal des modifications](../CHANGELOG.md).

## Systèmes compatibles

| Système                                                  | État           |
| -------------------------------------------------------- | -------------- |
| Caséta Smart Hub (L-BDG2, vendu dans les kits de départ) | compatible     |
| Caséta Smart Bridge PRO (L-BDGPRO2)                      | compatible     |
| RA2 Select (RR-SEL-REP2)                                 | compatible     |
| RadioRA 3, HomeWorks QSX                                 | prévu (0.2.0)  |
| Ancien Smart Bridge (L-BDG, avant LEAP)                  | non compatible |
| RadioRA 2, HomeWorks QS (telnet)                         | non compatible |

Appareils : variateurs (Caséta, Diva, Sunnata, à brancher, en ligne),
interrupteurs et modules à brancher, stores et stores à lames, commandes de
ventilateur, détecteurs de présence, télécommandes Pico.

## Ce qui reste local, ce qui ne l'est pas

- **Gladys ↔ bridge : 100 % local.** L'association, la découverte, le
  pilotage et les événements passent directement de Gladys au bridge sur
  votre réseau. Ils continuent de fonctionner sans Internet.
- **L'ajout d'appareils au bridge** se fait une fois dans l'application
  Lutron, qui demande un compte Lutron. C'est l'installation propre à
  Lutron, en dehors de Gladys. Ensuite, l'intégration n'a plus jamais
  besoin ni de l'application ni d'Internet. Une télécommande Pico peut aussi
  être associée directement à un variateur, sans application.

## Installation

1. Branchez le bridge sur votre box avec son câble réseau et ajoutez-y vos
   appareils dans l'application Lutron.
2. Donnez au bridge une **adresse IP fixe** (réservation DHCP dans votre
   box) pour que Gladys le retrouve toujours.
3. Dans Gladys, installez l'intégration **Lutron** et ouvrez sa
   configuration.
4. Laissez l'adresse IP vide (le bridge est cherché sur votre réseau) ou
   saisissez-la, puis cliquez sur **Associer le bridge**.
5. Dans les 60 secondes, appuyez sur le **petit bouton noir au dos du
   bridge**. L'état passe à « Connecté ».
6. Ouvrez l'onglet **Découverte** et créez les appareils voulus.

Si la recherche ne trouve rien, saisissez l'adresse IP : certains réseaux
(VLAN, Wi-Fi maillé, installations Docker) bloquent les annonces de
découverte, pas la connexion elle-même.

## Appareils

Chaque appareil Lutron devient un appareil Gladys nommé d'après sa pièce
Lutron (« Salon Plafonnier »), prêt à ranger dans la pièce Gladys
correspondante :

| Lutron                                  | Dans Gladys                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| Variateur (Diva, Caséta, Sunnata…)      | Lumière : marche/arrêt et luminosité                                                 |
| Interrupteur, module à brancher, relais | Interrupteur : marche/arrêt                                                          |
| Commande de ventilateur                 | Ventilateur : vitesse en % (0 arrêt, 25 lent, 50 moyen, 75 moyen-rapide, 100 rapide) |
| Store, store enrouleur, store plissé    | Volet : ouvrir / fermer / stop et position                                           |
| Rideau                                  | Rideau : ouvrir / fermer / stop et position                                          |
| Store vénitien en bois (lames seules)   | Volet : la position oriente les lames (50 = ouvertes, 0 = fermées)                   |
| Détecteurs de présence d'une pièce      | Présence : occupée / libre                                                           |
| Scène Lutron                            | Bouton « Activer »                                                                   |
| Bridge                                  | Interrupteur « Smart Away »                                                          |
| Store ou détecteur à piles              | « Pile faible » (Lutron indique seulement bonne ou faible)                           |

« Marche » rallume une lumière à son dernier niveau. Les états suivent le
bridge en temps réel, et sont relus toutes les 15 minutes et après chaque
reconnexion. Le badge de l'appareil indique « local », ou « injoignable »
quand le bridge ne répond plus depuis 2 minutes.

## Télécommandes Pico

Chaque Pico devient un appareil Gladys avec un bouton par bouton physique
(On, Off, Monter, Descendre, Favori…). Dans une scène, utilisez le
déclencheur **« Changement d'état de l'appareil »**, choisissez le bouton et le
type d'appui.

L'option **Boutons des télécommandes Pico** règle la détection des appuis :

- **Instantané** : un clic est signalé dès l'appui, sans aucun délai. Les
  doubles clics et appuis longs ne sont pas détectés.
- **Normal** (par défaut) : clic, double clic et appui long sont détectés.
  Un clic simple est signalé environ 0,3 s plus tard, le temps de vérifier
  qu'aucun second appui ne suit.
- **Lent** : comme Normal, avec des délais plus larges (0,45 s pour un
  double clic, 0,75 s pour un appui long), pour ceux qui appuient lentement.

Exemples avec le déclencheur « Changement d'état de l'appareil » sur un
bouton de Pico :

| Bouton et type d'appui                                | Scène                                     |
| ----------------------------------------------------- | ----------------------------------------- |
| « On », **Clic**                                      | allumer les lumières du salon             |
| « On », **Double clic**                               | lancer la scène « Cinéma »                |
| « Off », **Appui long**                               | éteindre toutes les lumières de la maison |
| « Raise », **Appui long** puis **Appui long relâché** | démarrer, puis arrêter, une variation     |

Les boutons Raise et Lower (monter, descendre) répètent tant qu'on les
tient : leur appui long est détecté 0,25 s plus tard que les autres boutons,
pour qu'un appui court reste un clic. Deux clics identiques à la suite sont
deux événements : chacun lance la scène. La Pico n'indique pas le niveau de
sa pile (Lutron ne le transmet pas). Les noms des boutons restent en anglais
(On, Off, Favorite, Raise, Lower…), comme sur la télécommande.

## Durée de fondu

La **durée de fondu par défaut** s'applique à chaque niveau envoyé par
Gladys à un variateur. L'action de scène **« Lutron : régler un niveau avec
fondu »** amène un variateur à un niveau en un temps choisi, jusqu'à 4
heures (un réveil progressif, une baisse lente pour un film).

## Sécurité

Le bridge n'accepte Gladys qu'après l'appui sur son bouton. Le certificat
qu'il signe est conservé dans la configuration de Gladys (incluse dans les
sauvegardes Gladys, jamais affichée dans l'interface), et chaque connexion
vérifie le certificat du bridge : une autre machine ne peut pas se faire
passer pour votre bridge.

## Dépannage

- **« Bouton non pressé à temps »** : cliquez à nouveau sur Associer, puis
  appuyez sur le bouton du bridge dans les 60 secondes.
- **« Certificat refusé »** : le bridge a été réinitialisé. Cliquez sur
  **Oublier le bridge**, puis associez-le à nouveau.
- **États qui ne se mettent plus à jour** : cliquez sur **Tester la
  connexion** ; l'intégration se reconnecte et relit aussi tous les états
  d'elle-même.
- **Pour signaler un problème** : voir « Diagnostic » ci-dessous.

## Diagnostic

Le bouton **Diagnostic** lit auprès du bridge la description de votre
système Lutron (pièces, appareils, boutons, scènes, niveaux actuels) et
l'écrit dans les journaux de l'intégration. Il ne fait que lire : rien n'est
modifié sur le bridge.

1. Cliquez sur **Diagnostic** (quelques secondes, jusqu'à une minute sur une
   grosse installation).
2. Ouvrez l'onglet **Journaux** de l'intégration.
3. Copiez toutes les lignes de `LUTRON DIAGNOSTICS BEGIN` à
   `LUTRON DIAGNOSTICS END` et joignez-les à votre signalement.

L'export est anonymisé : les numéros de série sont remplacés par `serial-1`,
`serial-2`…, les adresses MAC et IP et toute position géographique sont
masquées, et aucun certificat ni aucune clé n'y figure jamais. Les noms des
pièces et des appareils sont conservés, car ils expliquent votre
installation ; renommez-les dans l'export si vous préférez. Quand le bridge
n'est pas connecté, seul l'état de la connexion est écrit.

Non affilié à Lutron Electronics. Lutron, Caséta, Pico, RadioRA et
HomeWorks sont des marques de Lutron Electronics Co., Inc.
