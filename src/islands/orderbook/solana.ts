// Solana Pay payment session. Everything here is lazy-imported so the
// heavy web3 bundle only loads when someone actually opens a buy ticket.

export type PaymentSession = {
  url: string;
  qr: string; // data-url PNG
  reference: string;
  abort: () => void;
};

export async function startPayment(opts: {
  recipient: string;
  amount: number; // in USDC
  usdcMint: string;
  rpc: string;
  label: string;
  message: string;
  onConfirmed: (signature: string) => void;
  onError: (err: unknown) => void;
}): Promise<PaymentSession> {
  const [web3, pay, QRCode, { default: BigNumber }] = await Promise.all([
    import('@solana/web3.js'),
    import('@solana/pay'),
    import('qrcode'),
    import('bignumber.js'),
  ]);

  const reference = web3.Keypair.generate().publicKey;
  const url = pay.encodeURL({
    recipient: new web3.PublicKey(opts.recipient),
    amount: new BigNumber(opts.amount),
    splToken: new web3.PublicKey(opts.usdcMint),
    reference,
    label: opts.label,
    message: opts.message,
  });

  const qr = await QRCode.toDataURL(url.toString(), {
    margin: 1,
    width: 232,
    color: { dark: '#0c0b09', light: '#eae7e0' },
  });

  const connection = new web3.Connection(opts.rpc, 'confirmed');
  let stopped = false;

  const timer = setInterval(async () => {
    if (stopped) return;
    try {
      const found = await pay.findReference(connection, reference, {
        finality: 'confirmed',
      });
      stopped = true;
      clearInterval(timer);
      try {
        await pay.validateTransfer(connection, found.signature, {
          recipient: new web3.PublicKey(opts.recipient),
          amount: new BigNumber(opts.amount),
          splToken: new web3.PublicKey(opts.usdcMint),
        });
        opts.onConfirmed(found.signature);
      } catch (err) {
        opts.onError(err);
      }
    } catch (err: any) {
      // FindReferenceError means "not paid yet" — keep polling.
      // Transient RPC failures also fall through to the next poll.
      if (err?.name !== 'FindReferenceError' && err?.constructor?.name !== 'FindReferenceError') {
        // swallow; next tick retries
      }
    }
  }, 4000);

  return {
    url: url.toString(),
    qr,
    reference: reference.toBase58(),
    abort: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
