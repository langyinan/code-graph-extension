from .models import User
from app.services import auth
import os
import json

def main():
    setup()
    auth()

def setup():
    path = os.getcwd()
    return User(path)
