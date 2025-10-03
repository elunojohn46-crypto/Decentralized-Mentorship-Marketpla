(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-MENTOR u101)
(define-constant ERR-INVALID-AMOUNT u102)
(define-constant ERR-INVALID-DATE u103)
(define-constant ERR-SESSION-NOT-FOUND u104)
(define-constant ERR-SESSION-EXPIRED u105)
(define-constant ERR-INVALID-STATUS u106)
(define-constant ERR-ALREADY-BOOKED u107)
(define-constant ERR-INVALID-CANCELLATION u108)
(define-constant ERR-INSUFFICIENT-BALANCE u109)
(define-constant ERR-MENTOR-NOT-AVAILABLE u110)
(define-constant ERR-INVALID-TIMESTAMP u111)
(define-constant ERR-INVALID-SESSION-ID u112)
(define-constant ERR-MENTOR-REGISTRY-NOT-SET u113)
(define-constant ERR-TOKEN-CONTRACT-NOT-SET u114)

(define-data-var session-counter uint u0)
(define-data-var mentor-registry-contract (optional principal) none)
(define-data-var token-contract (optional principal) none)
(define-data-var cancellation-fee uint u100)
(define-data-var max-sessions-per-day uint u5)

(define-map sessions
  { session-id: uint }
  {
    mentor: principal,
    mentee: principal,
    date: (string-ascii 10),
    price: uint,
    status: (string-ascii 20),
    timestamp: uint,
    feedback-submitted: bool
  }
)

(define-map mentor-availability
  { mentor: principal, date: (string-ascii 10) }
  { session-count: uint }
)

(define-read-only (get-session (session-id uint))
  (map-get? sessions { session-id: session-id })
)

(define-read-only (get-availability (mentor principal) (date (string-ascii 10)))
  (default-to { session-count: u0 } (map-get? mentor-availability { mentor: mentor, date: date }))
)

(define-read-only (get-session-count)
  (ok (var-get session-counter))
)

(define-private (validate-date (date (string-ascii 10)))
  (if (and (> (len date) u0) (<= (len date) u10))
      (ok true)
      (err ERR-INVALID-DATE))
)

(define-private (validate-amount (amount uint))
  (if (> amount u0)
      (ok true)
      (err ERR-INVALID-AMOUNT))
)

(define-private (validate-mentor (mentor principal))
  (if (is-some (var-get mentor-registry-contract))
      (let ((registry (unwrap! (var-get mentor-registry-contract) (err ERR-MENTOR-REGISTRY-NOT-SET))))
        (contract-call? registry is-mentor-verified mentor))
      (err ERR-MENTOR-REGISTRY-NOT-SET))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP))
)

(define-private (validate-status (status (string-ascii 20)))
  (if (or (is-eq status "pending") (is-eq status "confirmed") (is-eq status "cancelled") (is-eq status "completed"))
      (ok true)
      (err ERR-INVALID-STATUS))
)

(define-public (set-mentor-registry (registry principal))
  (begin
    (asserts! (is-none (var-get mentor-registry-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set mentor-registry-contract (some registry))
    (ok true)
  )
)

(define-public (set-token-contract (token principal))
  (begin
    (asserts! (is-none (var-get token-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set token-contract (some token))
    (ok true)
  )
)

(define-public (set-cancellation-fee (fee uint))
  (begin
    (asserts! (>= fee u0) (err ERR-INVALID-AMOUNT))
    (var-set cancellation-fee fee)
    (ok true)
  )
)

(define-public (book-session (mentor principal) (price uint) (date (string-ascii 10)))
  (let
    (
      (session-id (var-get session-counter))
      (availability (get-availability mentor date))
      (token (unwrap! (var-get token-contract) (err ERR-TOKEN-CONTRACT-NOT-SET)))
    )
    (try! (validate-mentor mentor))
    (try! (validate-amount price))
    (try! (validate-date date))
    (asserts! (< (get session-count availability) (var-get max-sessions-per-day)) (err ERR-MENTOR-NOT-AVAILABLE))
    (asserts! (is-ok (contract-call? token transfer price tx-sender mentor none)) (err ERR-INSUFFICIENT-BALANCE))
    (map-set sessions
      { session-id: session-id }
      {
        mentor: mentor,
        mentee: tx-sender,
        date: date,
        price: price,
        status: "pending",
        timestamp: block-height,
        feedback-submitted: false
      }
    )
    (map-set mentor-availability
      { mentor: mentor, date: date }
      { session-count: (+ (get session-count availability) u1) }
    )
    (var-set session-counter (+ session-id u1))
    (print { event: "session-booked", id: session-id, mentor: mentor, mentee: tx-sender })
    (ok session-id)
  )
)

(define-public (confirm-session (session-id uint))
  (let
    (
      (session (unwrap! (map-get? sessions { session-id: session-id }) (err ERR-SESSION-NOT-FOUND)))
    )
    (asserts! (is-eq (get mentor session) tx-sender) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get status session) "pending") (err ERR-INVALID-STATUS))
    (try! (validate-timestamp (get timestamp session)))
    (map-set sessions
      { session-id: session-id }
      (merge session { status: "confirmed" })
    )
    (print { event: "session-confirmed", id: session-id })
    (ok true)
  )
)

(define-public (cancel-session (session-id uint))
  (let
    (
      (session (unwrap! (map-get? sessions { session-id: session-id }) (err ERR-SESSION-NOT-FOUND)))
      (token (unwrap! (var-get token-contract) (err ERR-TOKEN-CONTRACT-NOT-SET)))
    )
    (asserts! (or (is-eq (get mentee session) tx-sender) (is-eq (get mentor session) tx-sender)) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get status session) "pending") (err ERR-INVALID-STATUS))
    (try! (validate-timestamp (get timestamp session)))
    (if (is-eq (get mentee session) tx-sender)
        (try! (contract-call? token transfer (var-get cancellation-fee) tx-sender (get mentor session) none))
        (try! (contract-call? token transfer (get price session) (get mentor session) (get mentee session) none)))
    (map-set sessions
      { session-id: session-id }
      (merge session { status: "cancelled" })
    )
    (map-set mentor-availability
      { mentor: (get mentor session), date: (get date session) }
      { session-count: (- (get session-count (get-availability (get mentor session) (get date session))) u1) }
    )
    (print { event: "session-cancelled", id: session-id })
    (ok true)
  )
)