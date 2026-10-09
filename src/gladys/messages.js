// -----------------------------------------------------------------------------
// Texts shown to the user (connection status, action results), in English and
// French. Each one says WHAT is wrong and WHAT to do, never just
// "disconnected" (forum best practice).
// -----------------------------------------------------------------------------

import {
  BridgeClosedEarlyError,
  BridgeUnreachableError,
  CertificateRefusedError,
  InvalidCredentialsError,
  LeapTimeoutError,
} from '../leap/errors.js';
import { FAMILY_LABELS } from '../leap/discovery.js';
import { PairingRefusedError, PairingTimeoutError } from '../leap/pairing.js';
import { SESSION_STATES } from '../leap/session.js';

/** @typedef {{ en: string, fr: string }} Message */

const SYSTEM_LABELS = { caseta: 'Caséta / RA2 Select', ra3: 'RadioRA 3', qsx: 'HomeWorks QSX' };

/**
 * @param {{ system?: string, name?: string | null, model?: string | null } | null} info
 * @returns {string} "Smart Bridge (L-BDG2-WH)" or the system name
 */
export function bridgeLabel(info) {
  if (!info) return 'Lutron';
  const name = info.name || SYSTEM_LABELS[info.system] || 'Lutron';
  return info.model ? `${name} (${info.model})` : name;
}

export const MESSAGES = Object.freeze({
  notPaired: {
    en: 'Not paired yet: press "Pair the bridge".',
    fr: 'Pas encore associé : cliquez sur « Associer le bridge ».',
  },
  invalidHost: (value) => ({
    en: `"${value}" is not a valid IPv4 address: type the IP address of the bridge (e.g. 192.168.1.20), or leave the field empty to search the network.`,
    fr: `« ${value} » n'est pas une adresse IPv4 valide : saisissez l'adresse IP du bridge (ex. 192.168.1.20), ou laissez le champ vide pour chercher sur le réseau.`,
  }),
  missingHost: {
    en: 'Paired, but the IP address of the bridge is empty: type it again, or press "Pair the bridge" to search the network.',
    fr: "Associé, mais l'adresse IP du bridge est vide : saisissez-la à nouveau, ou cliquez sur « Associer le bridge » pour chercher sur le réseau.",
  },
  noBridgeFound: {
    en: 'No Lutron bridge answered on the network. Check that it is plugged into your router, or type its IP address (found in your router) and pair again.',
    fr: "Aucun bridge Lutron n'a répondu sur le réseau. Vérifiez qu'il est branché sur votre box, ou saisissez son adresse IP (visible dans votre box) et associez à nouveau.",
  },
  scanUnavailable: {
    en: 'The network search is not available: type the IP address of the bridge, then pair again.',
    fr: "La recherche sur le réseau n'est pas disponible : saisissez l'adresse IP du bridge, puis associez à nouveau.",
  },
  severalBridges: (bridges) => {
    const list = bridges.map((b) => `${b.host} (${FAMILY_LABELS[b.family]})`).join(', ');
    return {
      en: `Several Lutron bridges found: ${list}. Type the IP address of the one to pair, save, then pair again.`,
      fr: `Plusieurs bridges Lutron trouvés : ${list}. Saisissez l'adresse IP de celui à associer, enregistrez, puis associez à nouveau.`,
    };
  },
  pressButton: (host) => ({
    en: `Press the small black button at the back of the bridge (${host}) now.`,
    fr: `Appuyez maintenant sur le petit bouton noir au dos du bridge (${host}).`,
  }),
  paired: (host, info) => ({
    en: `Paired with ${bridgeLabel(info)} at ${host}. Open the Discover tab to add your devices.`,
    fr: `Associé à ${bridgeLabel(info)} à l'adresse ${host}. Ouvrez l'onglet Découverte pour ajouter vos appareils.`,
  }),
  pairingInProgress: {
    en: 'A pairing is already in progress.',
    fr: 'Une association est déjà en cours.',
  },
  forgotten: {
    en: 'The pairing was deleted. Press "Pair the bridge" to pair again.',
    fr: "L'association a été supprimée. Cliquez sur « Associer le bridge » pour associer à nouveau.",
  },
  bridgeMoved: (from, to) => ({
    en: `The bridge moved from ${from} to ${to}: address updated. Give it a fixed IP in your router.`,
    fr: `Le bridge est passé de ${from} à ${to} : adresse mise à jour. Donnez-lui une IP fixe dans votre box.`,
  }),
  notAvailableYet: {
    en: 'Not available yet in this development version.',
    fr: 'Pas encore disponible dans cette version de développement.',
  },
});

/**
 * Why an operation failed, for the user.
 *
 * @param {unknown} error
 * @param {string} host
 * @returns {Message}
 */
export function describeError(error, host) {
  if (error instanceof PairingTimeoutError) {
    return {
      en: 'The button on the bridge was not pressed in time. Press "Pair the bridge" again, then the small black button at the back of the bridge within 60 seconds.',
      fr: "Le bouton du bridge n'a pas été pressé à temps. Cliquez à nouveau sur « Associer le bridge », puis sur le petit bouton noir au dos du bridge dans les 60 secondes.",
    };
  }
  if (error instanceof PairingRefusedError) {
    return {
      en: `The bridge refused the pairing (${error.status || 'no answer'}). Press the button on the bridge only after clicking "Pair the bridge", then try again.`,
      fr: `Le bridge a refusé l'association (${error.status || 'pas de réponse'}). N'appuyez sur le bouton du bridge qu'après avoir cliqué sur « Associer le bridge », puis réessayez.`,
    };
  }
  if (error instanceof CertificateRefusedError && error.refusedBy === 'bridge') {
    return {
      en: 'The bridge no longer accepts Gladys (was it reset?). Press "Forget the bridge", then pair it again.',
      fr: "Le bridge n'accepte plus Gladys (a-t-il été réinitialisé ?). Cliquez sur « Oublier le bridge », puis associez-le à nouveau.",
    };
  }
  if (error instanceof CertificateRefusedError) {
    return {
      en: `The device at ${host} is not the paired bridge (its certificate does not match). If you replaced or reset the bridge, pair it again.`,
      fr: `L'appareil à l'adresse ${host} n'est pas le bridge associé (son certificat ne correspond pas). Si vous avez remplacé ou réinitialisé le bridge, associez-le à nouveau.`,
    };
  }
  if (error instanceof InvalidCredentialsError) {
    return {
      en: 'The stored pairing is damaged. Press "Forget the bridge", then pair it again.',
      fr: "L'association enregistrée est endommagée. Cliquez sur « Oublier le bridge », puis associez-le à nouveau.",
    };
  }
  if (error instanceof BridgeClosedEarlyError) {
    return {
      en: `The bridge at ${host} closes the connection right after accepting it. If it was reset, press "Forget the bridge" and pair it again; otherwise restart it.`,
      fr: `Le bridge à l'adresse ${host} ferme la connexion juste après l'avoir acceptée. S'il a été réinitialisé, cliquez sur « Oublier le bridge » et associez-le à nouveau ; sinon redémarrez-le.`,
    };
  }
  if (error instanceof BridgeUnreachableError) {
    return {
      en: `The bridge does not answer at ${host}${error.code ? ` (${error.code})` : ''}: check that it is powered and plugged into the network. Gladys keeps retrying.`,
      fr: `Le bridge ne répond pas à l'adresse ${host}${error.code ? ` (${error.code})` : ''} : vérifiez qu'il est alimenté et branché sur le réseau. Gladys réessaie en continu.`,
    };
  }
  if (error instanceof LeapTimeoutError) {
    return {
      en: `The bridge at ${host} is slow to answer (${error.url}). Gladys keeps retrying.`,
      fr: `Le bridge à l'adresse ${host} tarde à répondre (${error.url}). Gladys réessaie en continu.`,
    };
  }
  const detail = error instanceof Error ? error.message : String(error);
  return {
    en: `Lutron bridge at ${host}: ${detail}. Gladys keeps retrying.`,
    fr: `Bridge Lutron à l'adresse ${host} : ${detail}. Gladys réessaie en continu.`,
  };
}

/**
 * The connection status shown in the Configuration screen.
 *
 * @param {{ state: string, error: Error | null, leapVersion: string | null, host: string }} status
 * @param {object | null} info bridge information (bridgeInfo.js), once read
 * @returns {{ connected: boolean, message: Message }}
 */
export function describeSession(status, info) {
  const { state, error, host, leapVersion } = status;
  if (state === SESSION_STATES.CONNECTED) {
    const version = leapVersion ? `, LEAP ${leapVersion}` : '';
    return {
      connected: true,
      message: {
        en: `Connected to ${bridgeLabel(info)} at ${host}${version}.`,
        fr: `Connecté à ${bridgeLabel(info)} à l'adresse ${host}${version}.`,
      },
    };
  }
  if (state === SESSION_STATES.CONNECTING && !error) {
    return {
      connected: false,
      message: {
        en: `Connecting to the bridge at ${host}…`,
        fr: `Connexion au bridge à l'adresse ${host}…`,
      },
    };
  }
  if (state === SESSION_STATES.STOPPED) {
    return { connected: false, message: MESSAGES.notPaired };
  }
  return { connected: false, message: describeError(error, host) };
}
