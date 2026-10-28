#!/usr/bin/env python3
"""
train_handwriting.py - Train an EMNIST CNN and Convert to TensorFlow.js

This script downloads the EMNIST (Extended MNIST) Balanced dataset (47 classes:
digits 0-9, uppercase A-Z, and 11 distinct lowercase letters), preprocesses
and corrects orientation, trains a high-accuracy Convolutional Neural Network (CNN)
using Keras, and converts the trained model into TensorFlow.js format for direct
use in the Air Canvas client-side web application.

Usage:
    python train_handwriting.py --epochs 12 --batch_size 128 --output_dir ./model

Prerequisites:
    pip install tensorflow tensorflowjs tensorflow-datasets numpy
"""

import os
import sys
import argparse
import json
import numpy as np

# Suppress overly verbose TensorFlow C++ logging
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

try:
    import tensorflow as tf
    from tensorflow.keras import layers, models, callbacks
except ImportError:
    print("Error: TensorFlow is not installed.")
    print("Please install required dependencies: pip install tensorflow tensorflowjs tensorflow-datasets")
    sys.exit(1)

# EMNIST Balanced 47 Class Label Mapping:
# 0-9: digits
# 10-35: uppercase letters 'A' through 'Z'
# 36-46: distinct lowercase letters: a, b, d, e, f, g, h, n, q, r, t
EMNIST_BALANCED_CLASSES = [
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
    'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
    'U', 'V', 'W', 'X', 'Y', 'Z',
    'a', 'b', 'd', 'e', 'f', 'g', 'h', 'n', 'q', 'r', 't'
]


def load_emnist_dataset():
    """
    Loads EMNIST Balanced dataset using tensorflow_datasets or falls back to synthetic/MNIST demo.
    Corrects EMNIST's native transposed/flipped orientation so training images are upright.
    """
    print("\n[1/5] Loading EMNIST Balanced dataset...")
    try:
        import tensorflow_datasets as tfds

        ds_train, ds_test = tfds.load(
            "emnist/balanced",
            split=["train", "test"],
            as_supervised=True,
            batch_size=-1
        )

        x_train, y_train = tfds.as_numpy(ds_train)
        x_test, y_test = tfds.as_numpy(ds_test)

        print(f"Loaded {len(x_train)} training samples and {len(x_test)} test samples.")

        # IMPORTANT: Raw EMNIST images are rotated 90 degrees counter-clockwise and flipped.
        # We rotate and flip them so they match natural upright human drawing orientation:
        print("Normalizing orientation (upright alignment)...")
        x_train = np.rot90(x_train, k=3, axes=(1, 2))
        x_train = np.flip(x_train, axis=2)

        x_test = np.rot90(x_test, k=3, axes=(1, 2))
        x_test = np.flip(x_test, axis=2)

    except Exception as err:
        print(f"Note: tensorflow_datasets load failed ({err}).")
        print("Falling back to standard MNIST dataset (0-9 digits) for verification...")

        (x_train, y_train), (x_test, y_test) = tf.keras.datasets.mnist.load_data()
        x_train = np.expand_dims(x_train, -1)
        x_test = np.expand_dims(x_test, -1)

    # Normalize pixel intensity from [0, 255] to [0.0, 1.0]
    x_train = x_train.astype("float32") / 255.0
    x_test = x_test.astype("float32") / 255.0

    return (x_train, y_train), (x_test, y_test)


def build_cnn_model(input_shape=(28, 28, 1), num_classes=47):
    """
    Constructs a lightweight, high-accuracy Convolutional Neural Network
    optimized for fast WebGL/WebGPU inference in the browser via TensorFlow.js.
    """
    print(f"\n[2/5] Building CNN architecture for {num_classes} classes...")

    model = models.Sequential([
        layers.Input(shape=input_shape),

        # Conv Block 1
        layers.Conv2D(32, kernel_size=(3, 3), padding="same", activation="relu"),
        layers.BatchNormalization(),
        layers.Conv2D(32, kernel_size=(3, 3), activation="relu"),
        layers.MaxPooling2D(pool_size=(2, 2)),
        layers.Dropout(0.25),

        # Conv Block 2
        layers.Conv2D(64, kernel_size=(3, 3), padding="same", activation="relu"),
        layers.BatchNormalization(),
        layers.Conv2D(64, kernel_size=(3, 3), activation="relu"),
        layers.MaxPooling2D(pool_size=(2, 2)),
        layers.Dropout(0.25),

        # Dense Classifier Head
        layers.Flatten(),
        layers.Dense(256, activation="relu"),
        layers.BatchNormalization(),
        layers.Dropout(0.50),
        layers.Dense(num_classes, activation="softmax")
    ])

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"]
    )

    model.summary()
    return model


def train_model(model, x_train, y_train, x_test, y_test, epochs=12, batch_size=128):
    """
    Trains the CNN model with EarlyStopping and ReduceLROnPlateau callbacks.
    """
    print(f"\n[3/5] Training model for {epochs} epochs (batch size: {batch_size})...")

    lr_reducer = callbacks.ReduceLROnPlateau(
        monitor="val_loss",
        factor=0.5,
        patience=2,
        min_lr=1e-5,
        verbose=1
    )

    early_stopper = callbacks.EarlyStopping(
        monitor="val_accuracy",
        patience=4,
        restore_best_weights=True,
        verbose=1
    )

    history = model.fit(
        x_train, y_train,
        validation_data=(x_test, y_test),
        epochs=epochs,
        batch_size=batch_size,
        callbacks=[lr_reducer, early_stopper],
        verbose=1
    )

    # Evaluate final test accuracy
    print("\n[4/5] Evaluating test accuracy...")
    test_loss, test_acc = model.evaluate(x_test, y_test, verbose=0)
    print(f"--> Test Accuracy: {test_acc * 100:.2f}% | Test Loss: {test_loss:.4f}")

    return history


def convert_to_tfjs(model, output_dir, class_labels):
    """
    Exports the trained Keras model directly to TensorFlow.js format (model.json + shard weights).
    """
    print(f"\n[5/5] Exporting model to TensorFlow.js format at '{output_dir}'...")
    os.makedirs(output_dir, exist_ok=True)

    # Save intermediate Keras format
    keras_path = os.path.join(output_dir, "model_temp.keras")
    model.save(keras_path)

    # Convert using tensorflowjs Python API
    try:
        import tensorflowjs as tfjs
        tfjs.converters.save_keras_model(model, output_dir)
        print(f"Successfully generated TensorFlow.js model in {output_dir}:")
        print(f" - {os.path.join(output_dir, 'model.json')}")
        print(f" - Shard binary weights (.bin)")
    except ImportError:
        print("Note: 'tensorflowjs' package not installed directly.")
        print("You can convert the saved Keras model using the CLI command:")
        print(f"    tensorflowjs_converter --input_format=keras {keras_path} {output_dir}")

    # Write class labels metadata file for verification
    labels_file = os.path.join(output_dir, "classes.json")
    with open(labels_file, "w", encoding="utf-8") as f:
        json.dump({"classes": class_labels, "count": len(class_labels)}, f, indent=2)
    print(f" - Saved label metadata: {labels_file}")

    if os.path.exists(keras_path):
        os.remove(keras_path)


def main():
    parser = argparse.ArgumentParser(description="Train EMNIST CNN for Air Canvas Handwriting Recognition")
    parser.add_argument("--epochs", type=int, default=12, help="Number of training epochs (default: 12)")
    parser.add_argument("--batch_size", type=int, default=128, help="Batch size for training (default: 128)")
    parser.add_argument("--output_dir", type=str, default="./model", help="Target output directory for TF.js files")
    args = parser.parse_args()

    # 1. Load Data
    (x_train, y_train), (x_test, y_test) = load_emnist_dataset()
    num_classes = int(np.max(y_train) + 1)
    labels = EMNIST_BALANCED_CLASSES[:num_classes]

    # 2. Build Model
    model = build_cnn_model(input_shape=(28, 28, 1), num_classes=num_classes)

    # 3. Train
    train_model(model, x_train, y_train, x_test, y_test, epochs=args.epochs, batch_size=args.batch_size)

    # 4. Convert & Export
    convert_to_tfjs(model, args.output_dir, labels)

    print("\nAll done! You can now start Air Canvas and test touchless handwriting recognition in Write Mode.")


if __name__ == "__main__":
    main()
