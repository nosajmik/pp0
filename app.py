import uuid
from bitarray import bitarray
from flask import Flask, render_template

app = Flask(__name__)
uuids = set()
prefix = bitarray("11001010")


@app.route("/send")
def sender():
    identifierBits = None
    while True:
        bits = bitarray()
        candidate = uuid.uuid4()
        bits.frombytes(candidate.bytes)
        if (prefix not in bits) and (str(candidate) not in uuids):
            uuids.add(str(candidate))
            print(str(candidate))
            identifierBits = bits
            break
    print(prefix.to01())
    print(identifierBits.to01())
    return render_template("send.html", prefix=prefix.to01(), identifier=identifierBits.to01())


@app.route("/recv")
def receiver():
    return render_template("recv.html", prefix=prefix.to01())


if __name__ == '__main__':
    app.run(debug=True, host="0.0.0.0")