import { useSearchParams } from 'react-router-dom'

export default function PaymentCancel() {
  const [searchParams] = useSearchParams()
  const paymentId = searchParams.get('id')

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="bg-white rounded-2xl p-8 shadow-lg max-w-md w-full text-center">
        <div className="text-6xl mb-4">⚠️</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Paiement annulé</h2>
        <p className="text-gray-600 mb-6">
          Le paiement a été annulé. Aucun montant n&apos;a été prélevé.
        </p>
        {paymentId && (
          <>
            <p className="text-xs text-gray-400 mb-4">Réf. {paymentId.slice(0, 8)}</p>
            <a
              href={`dopamine://payment/cancel?id=${paymentId}`}
              className="block w-full text-center bg-gray-900 text-lime-400 font-bold py-3 px-6 rounded-xl mb-2"
            >
              Retourner dans l&apos;app Dopamine
            </a>
          </>
        )}
        <button
          onClick={() => window.close()}
          className="bg-white border border-gray-200 text-gray-900 px-6 py-3 rounded-xl font-bold w-full"
        >
          Fermer cette fenêtre
        </button>
        <p className="text-xs text-gray-400 mt-3">
          Vous pouvez fermer cette fenêtre et retourner dans l&apos;app.
        </p>
      </div>
    </div>
  )
}
