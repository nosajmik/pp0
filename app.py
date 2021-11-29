import uuid
from bitarray import bitarray
from flask import Flask, render_template, request

app = Flask(__name__)
uuids = set()
prefix = bitarray("11001010")


@app.route("/send")
def sender():
    while True:
        candidate = (uuid.uuid4().int >> 96).to_bytes(4, "big")
        bits = bitarray()
        bits.frombytes(candidate)
        if (prefix not in bits) and (bits.to01() not in uuids):
            uuids.add(bits.to01())
            print(f"Prefix in binary: {prefix.to01()}")
            print(f"Identifier in binary: {bits.to01()}")
            return render_template("send.html", prefix=prefix.to01(), identifier=bits.to01())


@app.route("/recv")
def receiver():
    return render_template("recv.html", prefix=prefix.to01())


@app.route("/upload")
def receiverUpload():
    identifier = request.args.get("uuid")
    print(f"Identifier received: {identifier}")
    if identifier in uuids:
        print("Match found")
    # No content to return
    return ('', 204)


if __name__ == '__main__':
    app.run(debug=True, host="0.0.0.0")